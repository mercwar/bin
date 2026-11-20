window.AvisStarMap = (() => {
  const CONFIG = {
    owner: 'mercwar',
    repo: 'AVIS-DATALAKE',
    branch: 'main',
    forksFile: 'forks.json'
  };

  const state = {
    treeData: {
      name: CONFIG.repo,
      path: '',
      type: 'dir',
      url: `https://github.com{CONFIG.owner}/${CONFIG.repo}`,
      children: []
    },
    dirNodes: [],
    dirEdges: [],
    currentPath: '',
    hoveredNode: null,
    onRenderRequest: null
  };

  // Deterministic FNV-1a hash for consistent 3D coordinates
  function hashString(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) / 4294967295;
  }

  function buildHierarchy(flatItems) {
    state.treeData.children = [];
    const map = { '': state.treeData };

    flatItems.sort((a, b) => a.path.localeCompare(b.path));

    for (const item of flatItems) {
      const parts = item.path.split('/');
      const name = parts[parts.length - 1];
      const parentPath = parts.slice(0, -1).join('/');
      const parent = map[parentPath] || state.treeData;

      const isDir = item.type === 'tree';
      const node = {
        name,
        path: item.path,
        type: isDir ? 'dir' : 'file',
        size: item.size || 0,
        url: `https://github.com{CONFIG.owner}/${CONFIG.repo}/${isDir ? 'tree' : 'blob'}/${CONFIG.branch}/${item.path}`,
        children: []
      };

      parent.children.push(node);
      if (isDir) {
        map[item.path] = node;
      }
    }
  }

  function injectForkNode(fork) {
    if (!fork || !fork.repo) return;
    const ownerLabel = fork.owner ? `${fork.owner}/` : '';
    const forkPath = `forks/${fork.owner || 'external'}/${fork.repo}`;

    let forksDir = state.treeData.children.find((c) => c.path === 'forks');
    if (!forksDir) {
      forksDir = {
        name: 'forks',
        path: 'forks',
        type: 'dir',
        isForkCluster: true,
        url: `https://github.com{CONFIG.owner}/${CONFIG.repo}/network/members`,
        children: []
      };
      state.treeData.children.unshift(forksDir);
    }

    forksDir.children.push({
      name: `${ownerLabel}${fork.repo}`,
      path: forkPath,
      type: 'fork',
      url: fork.url || `https://github.com{fork.owner}/${fork.repo}`,
      children: []
    });
  }

  function buildStarGraph() {
    state.dirNodes = [];
    state.dirEdges = [];

    function traverse(node, parentIdx, depth, parentPos) {
      if (node.type !== 'dir' && node.type !== 'fork') return;

      let x = 0;
      let y = 0;
      let z = 0;

      if (depth > 0) {
        const theta = hashString(`${node.path}:theta`) * Math.PI * 2;
        const phi = Math.acos(2 * hashString(`${node.path}:phi`) - 1);
        const dist = depth === 1 ? 140 : 65 / Math.sqrt(depth);

        x = parentPos.x + dist * Math.sin(phi) * Math.cos(theta);
        y = parentPos.y + dist * Math.sin(phi) * Math.sin(theta);
        z = parentPos.z + dist * Math.cos(phi);
      }

      const idx = state.dirNodes.length;
      state.dirNodes.push({
        idx,
        name: node.name,
        path: node.path,
        type: node.type,
        isFork: node.type === 'fork' || Boolean(node.isForkCluster),
        url: node.url,
        depth,
        x,
        y,
        z,
        sx: 0,
        sy: 0,
        vz: 0,
        visible: false
      });

      if (parentIdx !== null) {
        state.dirEdges.push([parentIdx, idx]);
      }

      for (const child of node.children) {
        traverse(child, idx, depth + 1, { x, y, z });
      }
    }

    traverse(state.treeData, null, 0, { x: 0, y: 0, z: 0 });
    document.getElementById('node-count').textContent = `${state.dirNodes.length} SYSTEMS`;
  }

  function findNodeByPath(path) {
    if (!path) return state.treeData;
    const parts = path.split('/');
    let curr = state.treeData;
    for (const part of parts) {
      if (!curr.children) return state.treeData;
      const next = curr.children.find((c) => c.name === part || c.path === path);
      if (!next) return curr;
      curr = next;
    }
    return curr;
  }

  function formatBytes(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  function navigateTo(path) {
    state.currentPath = path;
    const node = findNodeByPath(path);

    // Update EVE Autopilot Waypoints
    const routeContainer = document.getElementById('route-waypoints');
    routeContainer.innerHTML = '';

    const segments = path ? path.split('/') : [];
    const crumbs = [{ label: CONFIG.repo, path: '' }];
    let acc = '';
    for (const seg of segments) {
      acc = acc ? `${acc}/${seg}` : seg;
      crumbs.push({ label: seg, path: acc });
    }

    crumbs.forEach((crumb, i) => {
      const btn = document.createElement('div');
      btn.className = 'waypoint' + (i === crumbs.length - 1 ? ' active' : '');
      btn.innerHTML = `<span class="waypoint-box"></span><span>${crumb.label}</span>`;
      btn.onclick = () => navigateTo(crumb.path);
      routeContainer.appendChild(btn);

      if (i < crumbs.length - 1) {
        const sep = document.createElement('span');
        sep.className = 'waypoint-sep';
        sep.textContent = '»';
        routeContainer.appendChild(sep);
      }
    });

    // Update GitHub-Style Directory & File Browser
    const browser = document.getElementById('browser-container');
    browser.innerHTML = '';

    document.getElementById('current-folder-label').textContent = path ? `/${path}` : '/ (ROOT)';

    if (path) {
      const parentPath = path.split('/').slice(0, -1).join('/');
      const upRow = document.createElement('div');
      upRow.className = 'file-row';
      upRow.innerHTML = '<div class="file-left"><span class="icon-dir">..</span><span>Parent Directory</span></div>';
      upRow.onclick = () => navigateTo(parentPath);
      browser.appendChild(upRow);
    }

    const items = [...(node.children || [])].sort((a, b) => {
      const aIsDir = a.type === 'dir' || a.type === 'fork';
      const bIsDir = b.type === 'dir' || b.type === 'fork';
      if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    document.getElementById('item-count').textContent = `${items.length} ITEMS`;

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'file-row empty-msg';
      empty.textContent = 'No files in this directory.';
      browser.appendChild(empty);
    }

    for (const item of items) {
      if (item.type === 'dir') {
        const row = document.createElement('div');
        row.className = 'file-row';
        row.innerHTML = `
          <div class="file-left">
            <span class="icon-dir">[DIR]</span>
            <span>${item.name}</span>
          </div>
          <span class="file-meta">JUMP &rarr;</span>
        `;
        row.onclick = () => navigateTo(item.path);
        browser.appendChild(row);
      } else if (item.type === 'fork') {
        const link = document.createElement('a');
        link.className = 'file-row';
        link.href = item.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.innerHTML = `
          <div class="file-left">
            <span class="icon-fork">[FORK]</span>
            <span>${item.name}</span>
          </div>
          <span class="file-meta">EXTERNAL &nearr;</span>
        `;
        browser.appendChild(link);
      } else {
        const link = document.createElement('a');
        link.className = 'file-row';
        link.href = item.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.innerHTML = `
          <div class="file-left">
            <span class="icon-file">[FILE]</span>
            <span>${item.name}</span>
          </div>
          <span class="file-meta">${formatBytes(item.size)}</span>
        `;
        browser.appendChild(link);
      }
    }

    if (typeof state.onRenderRequest === 'function') {
      state.onRenderRequest();
    }
  }

  async function loadRepositoryData() {
    const statusEl = document.getElementById('sync-status');
    statusEl.textContent = 'SCANNING TREE...';

    try {
      const treeRes = await fetch(
        `https://github.com{CONFIG.owner}/${CONFIG.repo}/git/trees/${CONFIG.branch}?recursive=1`
      );
      if (!treeRes.ok) throw new Error(`HTTP ${treeRes.status}`);
      const treeJson = await treeRes.json();

      buildHierarchy(treeJson.tree || []);

      try {
        const forkRes = await fetch(`./${CONFIG.forksFile}`);
        if (forkRes.ok) {
          const forks = await forkRes.json();
          if (Array.isArray(forks)) {
            forks.forEach((f) => injectForkNode(f));
          }
        }
      } catch (_) {
        // Optional forks.json not yet created
      }

      buildStarGraph();
      navigateTo('');
      statusEl.textContent = 'ONLINE';
    } catch (err) {
      console.error(err);
      statusEl.textContent = 'OFFLINE / API LIMIT';
      buildStarGraph();
      navigateTo('');
    }
  }

  return {
    state,
    injectForkNode,
    buildStarGraph,
    navigateTo,
    loadRepositoryData
  };
})();
