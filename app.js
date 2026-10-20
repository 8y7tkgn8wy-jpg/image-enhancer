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
  var currentMode = 'ai';
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
  setMode('ai');

  function setMode(mode) {
    currentMode = mode;
    modeFidelity.classList.toggle('active', mode === 'fidelity');
    modeAI.classList.toggle('active', mode === 'ai');
    modeFidelity.setAttribute('aria-checked', mode === 'fidelity');
    modeAI.setAttribute('aria-checked', mode === 'ai');
    var oneX = scaleSelect.querySelector('option[value="1"]');
    if (mode === 'ai') {
      oneX.disabled = true;
      if (scaleSelect.value === '1') scaleSelect.value = '2';
      modeHint.textContent = 'AI 重建缺失细节，清晰度更高；可能补造原图不存在的细节，首次使用需联网下载模型。';
    } else {
      oneX.disabled = false;
      modeHint.textContent = 'Lanczos 高质量重采样 + 锐化，不改变原图元素，无需联网。';
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
    var strength = parseInt(sharpenRange.value, 10) / 100;

    processBtn.disabled = true;
    downloadBtn.disabled = true;

    if (currentMode === 'fidelity') {
      setStatus('正在处理（高质量放大）…', 'info');
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
      runAI(scale, strength);
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
    var sw = img.naturalWidth;
    var sh = img.naturalHeight;
    var w = Math.round(sw * scale);
    var h = Math.round(sh * scale);
    var MAX_DIM = 8192;
    if (w > MAX_DIM || h > MAX_DIM) {
      throw new Error('输出尺寸过大（' + w + '×' + h + ' px），请降低放大倍数');
    }

    var canvas;
    if (scale === 1) {
      canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0);
    } else if (w * h > 12000000) {
      // 超大图走快速路径，避免长时间阻塞
      canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      var fctx = canvas.getContext('2d');
      fctx.imageSmoothingEnabled = true;
      fctx.imageSmoothingQuality = 'high';
      fctx.drawImage(img, 0, 0, w, h);
    } else {
      var srcCanvas = document.createElement('canvas');
      srcCanvas.width = sw;
      srcCanvas.height = sh;
      var sctx = srcCanvas.getContext('2d', { willReadFrequently: true });
      sctx.drawImage(img, 0, 0);
      var srcData = sctx.getImageData(0, 0, sw, sh);
      var out = lanczosResample(srcData.data, sw, sh, w, h);
      canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d', { willReadFrequently: true }).putImageData(out, 0, 0);
    }

    if (strength > 0) {
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      unsharpMask(ctx, w, h, strength, scale);
    }
    return canvas;
  }

  function lanczos3(x) {
    if (x === 0) return 1;
    if (x <= -3 || x >= 3) return 0;
    var xpi = x * Math.PI;
    return 3 * Math.sin(xpi) * Math.sin(xpi / 3) / (xpi * xpi);
  }

  function lanczosResample(src, sw, sh, dw, dh) {
    var tmp = new Uint8ClampedArray(dw * sh * 4);
    var out = new Uint8ClampedArray(dw * dh * 4);
    var rx = sw / dw;
    var ry = sh / dh;
    var a = 3;

    function clampIdx(i, max) { return i < 0 ? 0 : i >= max ? max - 1 : i; }

    for (var y = 0; y < sh; y++) {
      var row = y * sw * 4;
      var trow = y * dw * 4;
      for (var x = 0; x < dw; x++) {
        var center = (x + 0.5) * rx - 0.5;
        var left = Math.ceil(center - a);
        var right = Math.floor(center + a);
        var r = 0, g = 0, b = 0, al = 0, wsum = 0;
        for (var i = left; i <= right; i++) {
          var wt = lanczos3(center - i);
          if (wt === 0) continue;
          var si = clampIdx(i, sw);
          var sp = row + si * 4;
          r += src[sp] * wt; g += src[sp + 1] * wt; b += src[sp + 2] * wt; al += src[sp + 3] * wt;
          wsum += wt;
        }
        var tp = trow + x * 4;
        tmp[tp] = r / wsum; tmp[tp + 1] = g / wsum; tmp[tp + 2] = b / wsum; tmp[tp + 3] = al / wsum;
      }
    }

    for (var x = 0; x < dw; x++) {
      var col = x * 4;
      for (var y = 0; y < dh; y++) {
        var centerY = (y + 0.5) * ry - 0.5;
        var top = Math.ceil(centerY - a);
        var bottom = Math.floor(centerY + a);
        var r = 0, g = 0, b = 0, al = 0, wsum = 0;
        for (var i = top; i <= bottom; i++) {
          var wt = lanczos3(centerY - i);
          if (wt === 0) continue;
          var si = clampIdx(i, sh);
          var sp = si * dw * 4 + col;
          r += tmp[sp] * wt; g += tmp[sp + 1] * wt; b += tmp[sp + 2] * wt; al += tmp[sp + 3] * wt;
          wsum += wt;
        }
        var op = y * dw * 4 + col;
        out[op] = r / wsum; out[op + 1] = g / wsum; out[op + 2] = b / wsum; out[op + 3] = al / wsum;
      }
    }
    return new ImageData(out, dw, dh);
  }

  function unsharpMask(ctx, w, h, amount, scale) {
    var imageData = ctx.getImageData(0, 0, w, h);
    var src = imageData.data;
    var sigma = Math.max(0.6, 0.5 * scale);
    var blurred = gaussianBlurRGB(src, w, h, sigma);
    var gain = amount * 1.8;
    for (var i = 0; i < src.length; i += 4) {
      for (var c = 0; c < 3; c++) {
        var idx = i + c;
        var v = src[idx] + gain * (src[idx] - blurred[idx]);
        src[idx] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }

  function sharpenCanvas(canvas, amount) {
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var src = imageData.data;
    var blurred = gaussianBlurRGB(src, canvas.width, canvas.height, 0.8);
    var gain = amount;
    for (var i = 0; i < src.length; i += 4) {
      for (var c = 0; c < 3; c++) {
        var idx = i + c;
        var v = src[idx] + gain * (src[idx] - blurred[idx]);
        src[idx] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }

  function gaussianBlurRGB(src, w, h, sigma) {
    var radius = Math.max(1, Math.ceil(sigma * 2));
    var kernel = [];
    var ksum = 0;
    for (var i = -radius; i <= radius; i++) {
      var v = Math.exp(-(i * i) / (2 * sigma * sigma));
      kernel.push(v);
      ksum += v;
    }
    for (var i = 0; i < kernel.length; i++) kernel[i] /= ksum;

    function clampIdx(i, max) { return i < 0 ? 0 : i >= max ? max - 1 : i; }

    var tmp = new Uint8ClampedArray(src.length);
    for (var y = 0; y < h; y++) {
      var row = y * w * 4;
      for (var x = 0; x < w; x++) {
        var r = 0, g = 0, b = 0;
        for (var k = -radius; k <= radius; k++) {
          var si = clampIdx(x + k, w);
          var sp = row + si * 4;
          var wt = kernel[k + radius];
          r += src[sp] * wt; g += src[sp + 1] * wt; b += src[sp + 2] * wt;
        }
        var p = row + x * 4;
        tmp[p] = r; tmp[p + 1] = g; tmp[p + 2] = b; tmp[p + 3] = src[p + 3];
      }
    }
    var out = new Uint8ClampedArray(src.length);
    for (var x = 0; x < w; x++) {
      var col = x * 4;
      for (var y = 0; y < h; y++) {
        var r = 0, g = 0, b = 0;
        for (var k = -radius; k <= radius; k++) {
          var si = clampIdx(y + k, h);
          var sp = si * w * 4 + col;
          var wt = kernel[k + radius];
          r += tmp[sp] * wt; g += tmp[sp + 1] * wt; b += tmp[sp + 2] * wt;
        }
        var p = y * w * 4 + col;
        out[p] = r; out[p + 1] = g; out[p + 2] = b; out[p + 3] = src[p + 3];
      }
    }
    return out;
  }

  /* ---------- AI (ESRGAN) ---------- */

  function runAI(scale, strength) {
    setStatus('正在加载 AI 模型（首次使用需下载，请稍候）…', 'info');
    nextFrame().then(function () {
      return ensureAIUpscaler();
    }).then(function () {
      setStatus('正在 AI 超分，大图可能耗时较长…', 'info');
      return nextFrame().then(function () {
        return aiUpscale(sourceImage, scale);
      });
    }).then(function (canvas) {
      if (strength > 0) {
        sharpenCanvas(canvas, strength);
      }
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
