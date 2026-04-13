document.addEventListener('DOMContentLoaded', () => {
  const ipc = window.electron.ipc;
  const state = {
    icon: null, splash: null, toggles: new Set(['splash', 'offline', 'pull-refresh', 'js']),
    building: false, lastApk: null
  };

  // UI Refs
  const els = {
    url: document.getElementById('url'),
    appName: document.getElementById('appName'),
    pkgName: document.getElementById('pkgName'),
    iconDrop: document.getElementById('icon-drop'),
    iconFile: document.getElementById('icon-file'),
    iconPreview: document.getElementById('icon-preview'),
    splashDrop: document.getElementById('splash-drop'),
    splashFile: document.getElementById('splash-file'),
    splashPreview: document.getElementById('splash-preview'),
    themeColor: document.getElementById('themeColor'),
    toggles: document.querySelectorAll('.toggle'),
    buildBtn: document.getElementById('build-btn'),
    progressCard: document.getElementById('progress-card'),
    stageLabel: document.getElementById('stage-label'),
    progressFill: document.getElementById('progress-fill'),
    logPanel: document.getElementById('log-panel'),
    downloadBtn: document.getElementById('download-apk'),
    openFolderBtn: document.getElementById('open-folder'),
    navBtns: document.querySelectorAll('.nav-btn'),
    views: document.querySelectorAll('.view'),
    historyList: document.getElementById('history-list')
  };

  // Init
  els.pkgName.value = `com.webapp.${els.appName.value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'demo'}`;
  
  // Drag & Drop
  ['icon', 'splash'].forEach(type => {
    const drop = els[`${type}Drop`], file = els[`${type}File`], preview = els[`${type}Preview`];
    drop.addEventListener('click', () => file.click());
    drop.addEventListener('dragover', e => e.preventDefault());
    drop.addEventListener('drop', e => {
      e.preventDefault();
      const f = e.dataTransfer.files[0];
      if(f && f.type === 'image/png') handleFile(type, f, preview, drop);
    });
    file.addEventListener('change', e => {
      const f = e.target.files[0];
      if(f) handleFile(type, f, preview, drop);
    });
  });

  function handleFile(type, file, preview, drop) {
    state[type] = file;
    const reader = new FileReader();
    reader.onload = e => {
      preview.src = e.target.result;
      preview.classList.remove('hidden');
      drop.querySelector('span').classList.add('hidden');
    };
    reader.readAsDataURL(file);
  }

  // Toggles
  els.toggles.forEach(t => t.addEventListener('click', () => {
    const val = t.dataset.val;
    if(state.toggles.has(val)) state.toggles.delete(val);
    else state.toggles.add(val);
    t.classList.toggle('active');
  }));

  // Nav
  els.navBtns.forEach(btn => btn.addEventListener('click', () => {
    els.navBtns.forEach(b => b.classList.remove('active'));
    els.views.forEach(v => v.classList.add('hidden'));
    btn.classList.add('active');
    document.getElementById(`${btn.dataset.view}-view`).classList.remove('hidden');
    if(btn.dataset.view === 'history') loadHistory();
  }));

  // Build
  async function startBuild() {
    if(state.building) return;
    if(!els.url.value) return toast('Enter a valid URL', 'error');
    if(!/^(https?:\/\/)/.test(els.url.value)) els.url.value = 'https://' + els.url.value.replace(/^https?:\/\//, '');
    
    state.building = true;
    els.buildBtn.disabled = true;
    els.buildBtn.style.transform = 'rotate(180deg)';
    els.progressCard.classList.remove('hidden');
    els.downloadBtn.classList.add('hidden');
    els.logPanel.innerHTML = '';
    els.logPanel.classList.add('show');
    els.progressFill.style.width = '0%';
    
    const config = {
      url: els.url.value,
      name: els.appName.value || 'WebApp',
      package: els.pkgName.value.replace(/\s/g, ''),
      color: els.themeColor.value,
      icon: state.icon ? await toBase64(state.icon) : null,
      splash: state.splash ? await toBase64(state.splash) : null,
      toggles: [...state.toggles],
      orientation: document.getElementById('orientation').value
    };

    ipc.invoke('start-build', config).then(res => {
      if(res.success) {
        state.lastApk = res.apkPath;
        els.stageLabel.textContent = 'Build Complete!';
        els.progressFill.style.width = '100%';
        els.downloadBtn.classList.remove('hidden');
        saveHistory(config, res.apkPath);
        toast('APK Generated Successfully!', 'success');
      } else {
        toast(`Failed: ${res.error}`, 'error');
        els.stageLabel.textContent = 'Build Failed';
      }
    }).finally(() => {
      state.building = false;
      els.buildBtn.disabled = false;
      els.buildBtn.style.transform = 'rotate(0deg)';
    });
  }

  els.buildBtn.addEventListener('click', startBuild);
  document.addEventListener('keydown', e => { if((e.ctrlKey || e.metaKey) && e.key === 'b') startBuild(); });

  // Progress Listener
  ipc.on('build-progress', data => {
    els.stageLabel.textContent = data.stage;
    els.progressFill.style.width = `${data.pct}%`;
    if(data.log) {
      const p = document.createElement('p');
      p.textContent = `> ${data.log}`;
      els.logPanel.prepend(p);
    }
  });

  els.downloadBtn.addEventListener('click', () => {
    if(state.lastApk) ipc.invoke('reveal-apk', state.lastApk);
  });
  els.openFolderBtn.addEventListener('click', () => ipc.invoke('open-output-folder'));

  // Utils
  function toBase64(file) {
    return new Promise((res) => {
      const r = new FileReader();
      r.onloadend = () => res(r.result.split(',')[1]);
      r.readAsDataURL(file);
    });
  }

  async function loadHistory() {
    const list = await ipc.invoke('get-history');
    if(!list.length) els.historyList.innerHTML = '<p>No builds yet</p>';
    els.historyList.innerHTML = list.map(h => `
      <div class="history-item">
        <div>
          <strong>${h.name}</strong><br><small>${new Date(h.date).toLocaleString()} • ${h.size}</small>
        </div>
        <div class="actions">
          <button class="btn-small" onclick="reveal('${h.path}')">📁</button>
        </div>
      </div>
    `).join('');
  }
  window.reveal = p => ipc.invoke('reveal-apk', p);

  function saveHistory(cfg, path) {
    const stat = require('fs').statSync(path); // Note: fs in renderer needs IPC, using mock size
    ipc.invoke('save-history', {
      name: cfg.name, date: Date.now(), path, url: cfg.url, size: `${(stat.size/1024/1024).toFixed(2)} MB`
    });
  }

  function toast(msg, type) {
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }
});
