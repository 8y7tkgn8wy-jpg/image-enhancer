(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var fileInput = $('fileInput');
  var dropzone = $('dropzone');
  var uploadSection = $('uploadSection');
  var workspaceSection = $('workspaceSection');
  var originalImg = $('originalImg');
  var resultImg = $('resultImg');
  var resultOnlyImg = $('resultOnlyImg');
  var compareView = $('compareView');
  var afterLayer = $('afterLayer');
  var divider = $('divider');
  var dimensionsInfo = $('dimensionsInfo');
  var modeFidelity = $('modeFidelity');
  var modeAI = $('modeAI');
  var modeHint = $('modeHint');
  var scaleSelect = $('scaleSelect');
  var sharpenField = $('sharpenField');
  var sharpenRange = $('sharpenRange');
  var sharpenValue = $('sharpenValue');
  var formatSelect = $('formatSelect');
  var jpegField = $('jpegField');
  var qualityRange = $('qualityRange');
  var qualityValue = $('qualityValue');
  var processBtn = $('processBtn');
  var downloadBtn = $('downloadBtn');
  var statusBar = $('statusBar');
  var compareBtn = $('compareBtn');
  var resultBtn = $('resultBtn');

  var sourceImage = null;
  var sourceFileName = 'image';
  var resultCanvas = null;
  var currentMode = 'fidelity';
  var aiState = { loading: false, loaded: false, upscaler: null };
  var aiUpscalers = {};

  var AI_LIBS = {
    tfjs: 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js',
    defaultModel: 'https://cdn.jsdelivr.net/npm/@upscalerjs/default-model@1.0.0/dist/umd/index.min.js',
    core: 'https://cdn.jsdelivr.net/npm/upscaler@1.0.0/dist/browser/umd/upscaler.min.js',
    models: {
      2: 'https://cdn.jsdelivr.net/npm/@upscalerjs/esrgan-slim@1.0.0/dist/umd/models/esrgan-slim/src/x2/index.min.js',
      3: 'https://cdn.jsdelivr.net/npm/@upscalerjs/esrgan-slim@1.0.0/dist/umd/models/esrgan-slim/src/x3/index.min.js',
      4: 'https://cdn.jsdelivr.net/npm/@upscalerjs/esrgan-slim@1.0.0/dist/umd/models/esrgan-slim/src/x4/index.min.js'
    }
  };

  var AI_MODEL_GLOBALS = { 2: 'ESRGANSlim2x', 3: 'ESRGANSlim3x', 4: 'ESRGANSlim4x' };

  /* ---------- status ---------- */

  function setStatus(msg, kind) {
    statusBar.textContent = msg || '';
    statusBar.className = 'status-bar' + (kind ? ' ' + kind : '');
  }

  function nextFrame() {
    return new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(resolve); }); });
  }

  /* ---------- upload ---------- */

  dropzone.addEventListener('click', function () { fileInput.click(); });
  dropzone.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener('change', function (e) {
    if (e.target.files && e.target.files[0]) handleFile(e.target.files[0]);
  });

  ['dragover', 'dragenter'].forEach(function (evt) {
    dropzone.addEventListener(evt, function (e) { e.preventDefault(); dropzone.classList.add('dragging'); });
  });
  ['dragleave', 'drop'].forEach(function (evt) {
    dropzone.addEventListener(evt, function (e) { e.preventDefault(); dropzone.classList.remove('dragging'); });
  });
  dropzone.addEventListener('drop', function (e) {
    var file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  function handleFile(file) {
    if (!file.type || file.type.indexOf('image/') !== 0) {
      setStatus('请选择图片文件', 'error');
      return;
    }
    sourceFileName = (file.name || 'image').replace(/\.[^.]+$/, '');
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      sourceImage = img;
      originalImg.src = url;
      resetResult();
      uploadSection.hidden = true;
      workspaceSection.hidden = false;
      setStatus('已载入：' + img.naturalWidth + ' × ' + img.naturalHeight + ' px', 'ok');
      renderDimensions(img.naturalWidth, img.naturalHeight, null);
    };
    img.onerror = function () {
      setStatus('图片加载失败，请换一张试试', 'error');
    };
    img.src = url;
  }

  function resetResult() {
    resultCanvas = null;
    resultImg.removeAttribute('src');
    resultOnlyImg.removeAttribute('src');
    downloadBtn.disabled = true;
    afterLayer.style.clipPath = 'inset(0 50% 0 0)';
    divider.style.left = '50%';
  }

  /* ---------- comparison slider ---------- */

  function initCompareSlider() {
    var dragging = false;

    function setPos(clientX) {
      var rect = compareView.getBoundingClientRect();
      if (rect.width === 0) return;
      var pct = ((clientX - rect.left) / rect.width) * 100;
      pct = Math.max(0, Math.min(100, pct));
      afterLayer.style.clipPath = 'inset(0 ' + (100 - pct) + '% 0 0)';
      divider.style.left = pct + '%';
    }

    divider.addEventListener('pointerdown', function (e) {
      dragging = true;
      divider.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    compareView.addEventListener('pointermove', function (e) {
      if (dragging) setPos(e.clientX);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (evt) {
      compareView.addEventListener(evt, function () { dragging = false; });
    });
    compareView.addEventListener('pointerdown', function (e) {
      if (e.target !== divider && !divider.contains(e.target)) setPos(e.clientX);
    });
  }
  initCompareSlider();

  /* ---------- view toggle ---------- */

  compareBtn.addEventListener('click', function () {
    compareBtn.classList.add('active');
    resultBtn.classList.remove('active');
    syncViewVisibility();
  });
  resultBtn.addEventListener('click', function () {
    resultBtn.classList.add('active');
    compareBtn.classList.remove('active');
    syncViewVisibility();
  });

  /* ---------- controls ---------- */

  modeFidelity.addEventListener('click', function () { setMode('fidelity'); });
  modeAI.addEventListener('click', function () { setMode('ai'); });

  function setMode(mode) {
    currentMode = mode;
    modeFidelity.classList.toggle('active', mode === 'fidelity');
    modeAI.classList.toggle('active', mode === 'ai');
    modeFidelity.setAttribute('aria-checked', mode === 'fidelity');
    modeAI.setAttribute('aria-checked', mode === 'ai');
    sharpenField.hidden = mode !== 'fidelity';
    var oneX = scaleSelect.querySelector('option[value="1"]');
    if (mode === 'ai') {
      oneX.disabled = true;
      if (scaleSelect.value === '1') scaleSelect.value = '2';
      modeHint.textContent = '注意：AI 可能补造原图中不存在的细节，请按需使用。';
    } else {
      oneX.disabled = false;
      modeHint.textContent = '推荐：严格按原图像素重采样 + 锐化，不改变任何元素。';
    }
  }

  sharpenRange.addEventListener('input', function () {
    sharpenValue.textContent = sharpenRange.value + '%';
  });
  formatSelect.addEventListener('change', function () {
    jpegField.hidden = formatSelect.value !== 'jpeg';
  });
  qualityRange.addEventListener('input', function () {
    qualityValue.textContent = qualityRange.value + '%';
  });

  /* ---------- processing ---------- */

  processBtn.addEventListener('click', runProcess);

  function runProcess() {
    if (!sourceImage) { setStatus('请先选择图片', 'error'); return; }
    var scale = parseInt(scaleSelect.value, 10);

    processBtn.disabled = true;
    downloadBtn.disabled = true;

    if (currentMode === 'fidelity') {
      var strength = parseInt(sharpenRange.value, 10) / 100;
      setStatus('正在处理（保真锐化）…', 'info');
      nextFrame().then(function () {
        try {
          resultCanvas = fidelityUpscale(sourceImage, scale, strength);
          finishResult('处理完成', null);
        } catch (err) {
          console.error(err);
          setStatus('处理失败：' + err.message, 'error');
          processBtn.disabled = false;
        }
      });
    } else {
      runAI(scale);
    }
  }

  function finishResult(msg, extra) {
    showResult();
    setStatus(msg, 'ok');
    downloadBtn.disabled = false;
    processBtn.disabled = false;
    renderDimensions(sourceImage.naturalWidth, sourceImage.naturalHeight, extra);
  }

  function showResult() {
    if (!resultCanvas) return;
    var dataUrl = resultCanvas.toDataURL('image/png');
    resultImg.src = dataUrl;
    resultOnlyImg.src = dataUrl;
    syncViewVisibility();
  }

  function syncViewVisibility() {
    var showCompare = compareBtn.classList.contains('active') || !resultCanvas;
    compareView.hidden = !showCompare;
    resultOnlyImg.hidden = showCompare;
  }

  function renderDimensions(sw, sh, extra) {
    var text = '原图：' + sw + ' × ' + sh + ' px';
    if (resultCanvas) text += '　→　结果：' + resultCanvas.width + ' × ' + resultCanvas.height + ' px';
    if (extra && extra.durationMs != null) text += '　·　耗时 ' + (extra.durationMs / 1000).toFixed(1) + ' 秒';
    dimensionsInfo.textContent = text;
  }

  /* ---------- fidelity (canvas) ---------- */

  function fidelityUpscale(img, scale, strength) {
    var w = Math.round(img.naturalWidth * scale);
    var h = Math.round(img.naturalHeight * scale);
    var MAX_DIM = 8192;
    if (w > MAX_DIM || h > MAX_DIM) {
      throw new Error('输出尺寸过大（' + w + '×' + h + ' px），请降低放大倍数');
    }
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    if (strength > 0) {
      var radius = Math.max(1, Math.round(scale * 0.8));
      unsharpMask(ctx, w, h, strength, radius);
    }
    return canvas;
  }

  function unsharpMask(ctx, w, h, amount, radius) {
    var imageData = ctx.getImageData(0, 0, w, h);
    var src = imageData.data;
    var len = src.length;
    var blurred = boxBlurRGB(src, w, h, radius);
    var gain = amount * 1.4;
    for (var i = 0; i < len; i += 4) {
      for (var c = 0; c < 3; c++) {
        var idx = i + c;
        var v = src[idx] + gain * (src[idx] - blurred[idx]);
        src[idx] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }

  function boxBlurRGB(src, w, h, radius) {
    var len = src.length;
    var tmp = new Uint8ClampedArray(len);
    var out = new Uint8ClampedArray(len);
    var div = 2 * radius + 1;

    function clampIdx(i, max) {
      return i < 0 ? 0 : i >= max ? max - 1 : i;
    }

    for (var y = 0; y < h; y++) {
      var row = y * w * 4;
      var r = 0, g = 0, b = 0;
      for (var i = -radius; i <= radius; i++) {
        var p0 = row + clampIdx(i, w) * 4;
        r += src[p0]; g += src[p0 + 1]; b += src[p0 + 2];
      }
      for (var x = 0; x < w; x++) {
        var p = row + x * 4;
        tmp[p] = r / div; tmp[p + 1] = g / div; tmp[p + 2] = b / div;
        var ps = row + clampIdx(x - radius, w) * 4;
        var pa = row + clampIdx(x + radius + 1, w) * 4;
        r -= src[ps]; g -= src[ps + 1]; b -= src[ps + 2];
        r += src[pa]; g += src[pa + 1]; b += src[pa + 2];
      }
    }

    for (var x = 0; x < w; x++) {
      var col = x * 4;
      var r2 = 0, g2 = 0, b2 = 0;
      for (var i = -radius; i <= radius; i++) {
        var q0 = clampIdx(i, h) * w * 4 + col;
        r2 += tmp[q0]; g2 += tmp[q0 + 1]; b2 += tmp[q0 + 2];
      }
      for (var y = 0; y < h; y++) {
        var q = y * w * 4 + col;
        out[q] = r2 / div; out[q + 1] = g2 / div; out[q + 2] = b2 / div;
        var qs = clampIdx(y - radius, h) * w * 4 + col;
        var qa = clampIdx(y + radius + 1, h) * w * 4 + col;
        r2 -= tmp[qs]; g2 -= tmp[qs + 1]; b2 -= tmp[qs + 2];
        r2 += tmp[qa]; g2 += tmp[qa + 1]; b2 += tmp[qa + 2];
      }
    }

    return out;
  }

  /* ---------- AI (ESRGAN) ---------- */

  function runAI(scale) {
    setStatus('正在加载 AI 模型（首次使用需下载，请稍候）…', 'info');
    nextFrame().then(function () {
      return ensureAIUpscaler();
    }).then(function () {
      setStatus('正在 AI 超分，大图可能耗时较长…', 'info');
      return nextFrame().then(function () {
        return aiUpscale(sourceImage, scale);
      });
    }).then(function (canvas) {
      resultCanvas = canvas;
      finishResult('AI 处理完成', {});
    }).catch(function (err) {
      console.error(err);
      var msg = err && err.message ? err.message : '未知错误';
      setStatus('AI 处理失败，已自动改用保真锐化（原因：' + msg + '）', 'info');
      setMode('fidelity');
      scaleSelect.value = String(Math.max(1, Math.min(4, scale)));
      var strength = parseInt(sharpenRange.value, 10) / 100;
      try {
        resultCanvas = fidelityUpscale(sourceImage, parseInt(scaleSelect.value, 10), strength);
        finishResult('已改用保真锐化完成', null);
      } catch (e2) {
        setStatus('处理失败：' + e2.message, 'error');
        processBtn.disabled = false;
      }
    });
  }

  function ensureAIUpscaler() {
    if (aiState.upscaler) return Promise.resolve(aiState.upscaler);
    if (aiState.loading) {
      return new Promise(function (resolve, reject) {
        var t = setInterval(function () {
          if (aiState.upscaler) { clearInterval(t); resolve(aiState.upscaler); }
          else if (!aiState.loading) { clearInterval(t); reject(new Error('模型加载已中断')); }
        }, 200);
      });
    }
    aiState.loading = true;
    return loadScript(AI_LIBS.tfjs)
      .then(function () { return loadScript(AI_LIBS.defaultModel); })
      .then(function () { return loadScript(AI_LIBS.core); })
      .then(function () {
        if (typeof window.Upscaler !== 'function' ||
            typeof window.tf === 'undefined' ||
            typeof window.tf.loadLayersModel !== 'function') {
          throw new Error('依赖库加载不完整');
        }
        aiState.upscaler = window.Upscaler;
        aiState.loaded = true;
        return aiState.upscaler;
      })
      .catch(function (err) {
        aiState.loading = false;
        throw err;
      });
  }

  function aiUpscale(img, scale) {
    var modelGlobal = AI_MODEL_GLOBALS[scale];
    var modelUrl = AI_LIBS.models[scale];
    return loadScript(modelUrl).then(function () {
      var model = window[modelGlobal];
      if (!model) throw new Error('模型脚本加载失败');
      if (!aiUpscalers[scale]) {
        aiUpscalers[scale] = new aiState.upscaler({ model: model });
      }
      var upscaler = aiUpscalers[scale];
      var maxDim = Math.max(img.naturalWidth, img.naturalHeight);
      var patchByScale = { 2: 128, 3: 129, 4: 128 };
      var options = maxDim > 800 ? { patchSize: patchByScale[scale] || 128, padding: 8 } : {};
      return upscaler.upscale(img, options);
    }).then(function (result) {
      return toCanvas(result);
    });
  }

  function toCanvas(result) {
    return new Promise(function (resolve, reject) {
      var url = typeof result === 'string' ? result : (result && result.src);
      if (!url) { reject(new Error('未获取到处理结果')); return; }
      var out = new Image();
      out.onload = function () { resolve(imageToCanvas(out)); };
      out.onerror = function () { reject(new Error('结果解码失败')); };
      out.src = url;
    });
  }

  function imageToCanvas(img) {
    var canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    canvas.getContext('2d').drawImage(img, 0, 0);
    return canvas;
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-src="' + src + '"]');
      if (existing) {
        if (existing.dataset.loaded === '1') { resolve(); return; }
        existing.addEventListener('load', function () { resolve(); }, { once: true });
        existing.addEventListener('error', function () { reject(new Error('脚本加载失败：' + src)); }, { once: true });
        return;
      }
      var s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.setAttribute('data-src', src);
      s.onload = function () { s.dataset.loaded = '1'; resolve(); };
      s.onerror = function () { s.remove(); reject(new Error('脚本加载失败：' + src)); };
      document.head.appendChild(s);
    });
  }

  /* ---------- download ---------- */

  downloadBtn.addEventListener('click', function () {
    if (!resultCanvas) return;
    var format = formatSelect.value;
    var mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
    var quality = format === 'jpeg' ? parseInt(qualityRange.value, 10) / 100 : undefined;
    var dataUrl = resultCanvas.toDataURL(mime, quality);
    var ext = format === 'jpeg' ? 'jpg' : 'png';
    var a = document.createElement('a');
    a.href = dataUrl;
    a.download = sourceFileName + '-enhanced.' + ext;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });
})();
