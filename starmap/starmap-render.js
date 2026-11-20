(() => {
  const { state, injectForkNode, buildStarGraph, navigateTo, loadRepositoryData } = window.AvisStarMap;

  const canvas = document.getElementById('starmap');
  const ctx = canvas.getContext('2d');

  // Static camera (no auto-rotation)
  const cam = {
    yaw: 0.45,
    pitch: 0.32,
    zoom: 520,
    isDragging: false,
    hasMoved: false,
    lastX: 0,
    lastY: 0
  };

  function resizeCanvas() {
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render();
  }

  function project(x, y, z, w, h) {
    const cosY = Math.cos(cam.yaw);
    const sinY = Math.sin(cam.yaw);
    const cosP = Math.cos(cam.pitch);
    const sinP = Math.sin(cam.pitch);

    const x1 = x * cosY - z * sinY;
    const z1 = z * cosY + x * sinY;

    const y2 = y * cosP - z1 * sinP;
    const z2 = z1 * cosP + y * sinP + cam.zoom;

    if (z2 <= 10) return null;
    const fov = 550;
    return {
      sx: (x1 * fov) / z2 + w / 2,
      sy: (y2 * fov) / z2 + h / 2,
      vz: z2
    };
  }

  function isNodeOnActiveRoute(nodePath) {
    if (nodePath === '') return true;
    return state.currentPath === nodePath || state.currentPath.startsWith(`${nodePath}/`);
  }

  function render() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    ctx.fillStyle = '#04060a';
    ctx.fillRect(0, 0, w, h);

    // Outer tactical ring
    ctx.strokeStyle = 'rgba(22, 38, 56, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.36, 0, Math.PI * 2);
    ctx.stroke();

    for (const n of state.dirNodes) {
      const p = project(n.x, n.y, n.z, w, h);
      if (p) {
        n.sx = p.sx;
        n.sy = p.sy;
        n.vz = p.vz;
        n.visible = true;
      } else {
        n.visible = false;
      }
    }

    // Draw constellation jump lines
    for (const [aIdx, bIdx] of state.dirEdges) {
      const a = state.dirNodes[aIdx];
      const b = state.dirNodes[bIdx];
      if (!a.visible || !b.visible) continue;

      const activeRoute = isNodeOnActiveRoute(a.path) && isNodeOnActiveRoute(b.path);

      ctx.beginPath();
      ctx.moveTo(a.sx, a.sy);
      ctx.lineTo(b.sx, b.sy);

      if (activeRoute) {
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 1.8;
      } else if (b.isFork) {
        ctx.strokeStyle = 'rgba(255, 184, 0, 0.25)';
        ctx.lineWidth = 1;
      } else {
        ctx.strokeStyle = 'rgba(29, 91, 121, 0.38)';
        ctx.lineWidth = 1;
      }
      ctx.stroke();
    }

    // Sort stars back-to-front
    const sorted = state.dirNodes.filter((n) => n.visible).sort((a, b) => b.vz - a.vz);

    for (const n of sorted) {
      const isSelected = n.path === state.currentPath;
      const isOnRoute = isNodeOnActiveRoute(n.path);
      const isHovered = state.hoveredNode && state.hoveredNode.idx === n.idx;

      const baseRadius = n.depth === 0 ? 5.5 : n.depth === 1 ? 3.8 : 2.6;
      const r = Math.max(1.8, baseRadius * (520 / n.vz));
      const color = n.isFork ? '#ffb800' : isOnRoute ? '#00f0ff' : '#4fa3d1';

      // Star halo
      const grad = ctx.createRadialGradient(n.sx, n.sy, 0, n.sx, n.sy, r * 3.5);
      grad.addColorStop(0, color);
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(n.sx, n.sy, r * 3.5, 0, Math.PI * 2);
      ctx.fill();

      // Star core
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(n.sx, n.sy, r * 0.55, 0, Math.PI * 2);
      ctx.fill();

      // EVE target reticle
      if (isSelected || isHovered) {
        const box = r + 7;
        ctx.strokeStyle = isSelected ? '#00f0ff' : '#ffb800';
        ctx.lineWidth = 1.2;
        ctx.strokeRect(n.sx - box, n.sy - box, box * 2, box * 2);
      }

      // System labels
      if (n.depth <= 1 || isOnRoute || isHovered || cam.zoom < 360) {
        ctx.font = isSelected || isHovered ? 'bold 11px Consolas, monospace' : '10px Consolas, monospace';
        ctx.fillStyle = isSelected ? '#00f0ff' : n.isFork ? '#ffb800' : '#9ec2db';
        ctx.fillText(n.name, n.sx + r + 8, n.sy + 3);
      }
    }
  }

  // Register render callback so navigation updates the canvas
  state.onRenderRequest = render;

  // =========================================================================
  // CAMERA & POINTER EVENTS
  // =========================================================================
  canvas.addEventListener('mousedown', (e) => {
    cam.isDragging = true;
    cam.hasMoved = false;
    cam.lastX = e.clientX;
    cam.lastY = e.clientY;
  });

  window.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (cam.isDragging) {
      const dx = e.clientX - cam.lastX;
      const dy = e.clientY - cam.lastY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) cam.hasMoved = true;
      cam.yaw += dx * 0.006;
      cam.pitch = Math.max(-1.45, Math.min(1.45, cam.pitch + dy * 0.006));
      cam.lastX = e.clientX;
      cam.lastY = e.clientY;
      render();
      return;
    }

    let closest = null;
    let minDist = 16;
    for (const n of state.dirNodes) {
      if (!n.visible) continue;
      const d = Math.hypot(mx - n.sx, my - n.sy);
      if (d < minDist) {
        minDist = d;
        closest = n;
      }
    }

    if (closest !== state.hoveredNode) {
      state.hoveredNode = closest;
      canvas.style.cursor = state.hoveredNode ? 'pointer' : 'grab';
      document.getElementById('hover-readout').textContent = state.hoveredNode
        ? `SYSTEM: /${state.hoveredNode.path || '(ROOT)'} — CLICK TO NAVIGATE`
        : 'DRAG TO ORBIT • SCROLL TO ZOOM • CLICK NODE TO JUMP';
      render();
    }
  });

  window.addEventListener('mouseup', () => {
    if (cam.isDragging && !cam.hasMoved && state.hoveredNode) {
      if (state.hoveredNode.type === 'fork') {
        window.open(state.hoveredNode.url, '_blank', 'noopener,noreferrer');
      } else {
        navigateTo(state.hoveredNode.path);
      }
    }
    cam.isDragging = false;
  });

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      cam.zoom = Math.max(140, Math.min(1400, cam.zoom + e.deltaY * 0.45));
      render();
    },
    { passive: false }
  );

  // =========================================================================
  // HUD CONTROLS & FORK REGISTRATION MODAL
  // =========================================================================
  document.getElementById('btn-reset').onclick = () => {
    cam.yaw = 0.45;
    cam.pitch = 0.32;
    cam.zoom = 520;
    render();
  };

  document.getElementById('btn-root').onclick = () => navigateTo('');

  const modal = document.getElementById('fork-modal');
  document.getElementById('btn-open-fork').onclick = () => modal.classList.add('open');
  document.getElementById('btn-close-fork').onclick = () => modal.classList.remove('open');

  document.getElementById('btn-preview-fork').onclick = () => {
    const owner = document.getElementById('fork-owner').value.trim();
    const repo = document.getElementById('fork-repo').value.trim();
    const url = document.getElementById('fork-url').value.trim() || `https://github.com{owner}/${repo}`;
    if (!owner || !repo) return;

    const entry = { owner, repo, url };
    const formatted = JSON.stringify(entry, null, 2);
    document.getElementById('fork-json-output').value = formatted;
    navigator.clipboard?.writeText(formatted);

    injectForkNode(entry);
    buildStarGraph();
    navigateTo('forks');
  };

  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
  loadRepositoryData();
})();
