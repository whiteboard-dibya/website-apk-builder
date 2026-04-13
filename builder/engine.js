const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const TEMPLATES = {
  manifest: `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="{{PKG}}">
  <uses-permission android:name="android.permission.INTERNET"/>
  <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE"/>
  <application android:allowBackup="true" android:icon="@mipmap/ic_launcher" android:label="@string/app_name" android:supportsRtl="true" android:theme="@style/Theme.App">
    <activity android:name=".MainActivity" android:configChanges="orientation|screenSize" android:exported="true" android:screenOrientation="{{ORIENT}}">
      <intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter>
    </activity>
  </application>
</manifest>`,
  mainActivity: `package {{PKG}};
import android.os.Bundle;
import android.webkit.WebView;
import android.webkit.WebSettings;
import android.webkit.WebViewClient;
import android.widget.ProgressBar;
import androidx.appcompat.app.AppCompatActivity;
public class MainActivity extends AppCompatActivity {
  WebView wv; ProgressBar pb;
  protected void onCreate(Bundle s) {
    super.onCreate(s); setContentView(R.layout.activity_main);
    wv = findViewById(R.id.webview); pb = findViewById(R.id.progress);
    WebSettings ws = wv.getSettings(); ws.setJavaScriptEnabled(true); ws.setDomStorageEnabled(true); ws.setCacheMode(WebSettings.LOAD_DEFAULT);
    wv.setWebViewClient(new WebViewClient(){
      public void onPageStarted(WebView v, String u, Bitmap b){ pb.setVisibility(1); }
      public void onPageFinished(WebView v, String u){ pb.setVisibility(2); }
    });
    wv.loadUrl("{{URL}}");
  }
}`,
  layout: `<?xml version="1.0" encoding="utf-8"?>
<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android" android:layout_width="match_parent" android:layout_height="match_parent">
  <WebView android:id="@+id/webview" android:layout_width="match_parent" android:layout_height="match_parent"/>
  <ProgressBar android:id="@+id/progress" android:layout_width="wrap_content" android:layout_height="wrap_content" android:layout_gravity="center"/>
</FrameLayout>`,
  buildGradle: `plugins { id 'com.android.application' }
android { compileSdk 34 defaultConfig { applicationId "{{PKG}}"; minSdk 24 targetSdk 34 versionCode 1 versionName "1.0" }
buildTypes { release { signingConfig signingConfigs.debug } }
}
dependencies { implementation 'androidx.appcompat:appcompat:1.6.1'; implementation 'com.google.android.material:material:1.11.0' }`,
  colors: `<?xml version="1.0" encoding="utf-8"?>
<resources><color name="primary">{{COLOR}}</color></resources>`,
  strings: `<resources><string name="app_name">{{NAME}}</string></resources>`
};

async function replaceAndWrite(dir, file, content, cfg) {
  const processed = content.replace(/{{PKG}}/g, cfg.package)
    .replace(/{{URL}}/g, cfg.url)
    .replace(/{{NAME}}/g, cfg.name)
    .replace(/{{COLOR}}/g, cfg.color)
    .replace(/{{ORIENT}}/g, cfg.orientation === 'portrait' ? 'portrait' : cfg.orientation === 'landscape' ? 'landscape' : 'unspecified');
  await fs.writeFile(path.join(dir, file), processed);
}

module.exports = {
  generate: async (cfg, outputDir, onProgress) => {
    const tmp = path.join(outputDir, `tmp_${uuidv4()}`);
    await fs.ensureDir(path.join(tmp, 'app/src/main/java', cfg.package.replace(/\./g, '/')));
    await fs.ensureDir(path.join(tmp, 'app/src/main/res/layout'));
    await fs.ensureDir(path.join(tmp, 'app/src/main/res/values'));
    await fs.ensureDir(path.join(tmp, 'app/src/main/res/mipmap-hdpi'));
    await fs.ensureDir(path.join(tmp, 'app/src/main/res/drawable'));

    onProgress('Injecting Data...', 15);
    await replaceAndWrite(tmp, 'app/src/main/AndroidManifest.xml', TEMPLATES.manifest, cfg);
    await replaceAndWrite(tmp, `app/src/main/java/${cfg.package.replace(/\./g, '/')}/MainActivity.java`, TEMPLATES.mainActivity, cfg);
    await replaceAndWrite(tmp, 'app/src/main/res/layout/activity_main.xml', TEMPLATES.layout, cfg);
    await replaceAndWrite(tmp, 'app/build.gradle', TEMPLATES.buildGradle, cfg);
    await replaceAndWrite(tmp, 'app/src/main/res/values/colors.xml', TEMPLATES.colors, cfg);
    await replaceAndWrite(tmp, 'app/src/main/res/values/strings.xml', TEMPLATES.strings, cfg);

    // Write settings.gradle & build.gradle
    await fs.writeFile(path.join(tmp, 'settings.gradle'), `rootProject.name = "${cfg.name.replace(/\s/g,'')}"\ninclude ':app'`);
    await fs.writeFile(path.join(tmp, 'build.gradle'), `buildscript { repositories { mavenCentral() } dependencies { classpath 'com.android.tools.build:gradle:8.2.0' } } allprojects { repositories { mavenCentral() } } task clean(type: Delete) { delete rootProject.buildDir }`);
    await fs.writeJSON(path.join(tmp, 'gradle.properties'), { 'android.useAndroidX': 'true', 'android.nonTransitiveRClass': 'true' });

    onProgress('Preparing Assets...', 35);
    if(cfg.icon) await fs.writeFile(path.join(tmp, 'app/src/main/res/mipmap-hdpi/ic_launcher.png'), Buffer.from(cfg.icon, 'base64'));
    if(cfg.splash) await fs.writeFile(path.join(tmp, 'app/src/main/res/drawable/splash.png'), Buffer.from(cfg.splash, 'base64'));

    onProgress('Compiling APK...', 50);
    // Run Gradle (Assumes gradle or wrapper is in PATH, or uses system gradle)
    return new Promise((resolve, reject) => {
      const gradleCmd = process.platform === 'win32' ? 'gradle.bat' : 'gradle';
      const child = spawn(gradleCmd, ['assembleRelease', '--console=plain'], { cwd: tmp, env: { ...process.env } });

      child.stdout.on('data', d => onProgress('Compiling...', 60, d.toString()));
      child.stderr.on('data', d => onProgress('Building...', 75, d.toString()));

      child.on('close', async code => {
        if (code !== 0) return reject('Gradle build failed');
        const outApk = path.join(tmp, 'app/build/outputs/apk/release/app-release-unsigned.apk');
        if(!fs.existsSync(outApk)) return reject('APK not generated');

        const finalApk = path.join(outputDir, `${cfg.name.replace(/\s/g, '_')}.apk`);
        await fs.move(outApk, finalApk, { overwrite: true });
        await fs.remove(tmp);
        onProgress('Done!', 100);
        resolve(finalApk);
      });
      child.on('error', reject);
    });
  }
};
