(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var fileInput = $('fileInput');
  var dropzone = $('dropzone');
  var uploadSection = $('uploadSection');
  var workspaceSection = $('workspaceSection');
  var resultPreview = $('resultPreview');
  var previewWrap = $('previewWrap');
  var previewPlaceholder = $('previewPlaceholder');
  var loupe = $('loupe');
  var dimensionsInfo = $('dimensionsInfo');
  var modeFidelity = $('modeFidelity');
  var modeAI = $('modeAI');
  var modeHint = $('modeHint');
  var tierSelect = $('tierSelect');
  var tierHint = $('tierHint');
  var formatSelect = $('formatSelect');
  var jpegField = $('jpegField');
  var qualityRange = $('qualityRange');
  var qualityValue = $('qualityValue');
  var processBtn = $('processBtn');
  var downloadBtn = $('downloadBtn');
  var statusBar = $('statusBar');

  var TIER_LABELS = { 1920: '1080P', 2560: '2K', 3840: '4K', 7680: '8K' };

  var sourceImage = null;
  var sourceFileName = 'image';
  var resultCanvas = null;
  var origScaled = null;
  var currentMode = 'ai';
  var aiState = { loading: false, loaded: false, upscaler: null };
  var aiUpscalers = {};

  var AI_LIBS = {
    tfjs: 'lib/tf.min.js',
    defaultModel: 'lib/default-model.min.js',
    core: 'lib/upscaler.min.js',
    models: {
      2: 'lib/esrgan-slim-x2.min.js',
      3: 'lib/esrgan-slim-x3.min.js',
      4: 'lib/esrgan-slim-x4.min.js'
    }
  };

  var AI_MODEL_GLOBALS = { 2: 'ESRGANSlim2x', 3: 'ESRGANSlim3x', 4: 'ESRGANSlim4x' };

  /* ---------- 通用工具 ---------- */

  function clamp(v, min, max) { return v < min ? min : v > max ? max : v; }

  function setStatus(msg, kind) {
    statusBar.textContent = msg || '';
    statusBar.className = 'status-bar' + (kind ? ' ' + kind : '');
  }

  function nextFrame() {
    return new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(resolve); }); });
  }

  function imageToCanvas(img) {
    var canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    canvas.getContext('2d').drawImage(img, 0, 0);
    return canvas;
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

  /* ---------- 上传 ---------- */

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
      resetResult();
      uploadSection.hidden = true;
      workspaceSection.hidden = false;
      setStatus('已载入 ' + img.naturalWidth + ' × ' + img.naturalHeight + ' px，点击「生成高清图」', 'ok');
      renderDimensions();
      updateTierHint();
    };
    img.onerror = function () { setStatus('图片加载失败，请换一张试试', 'error'); };
    img.src = url;
  }

  function resetResult() {
    resultCanvas = null;
    origScaled = null;
    resultPreview.removeAttribute('src');
    resultPreview.hidden = true;
    previewPlaceholder.hidden = false;
    loupe.hidden = true;
    downloadBtn.disabled = true;
  }

  /* ---------- 模式切换 ---------- */

  modeFidelity.addEventListener('click', function () { setMode('fidelity'); });
  modeAI.addEventListener('click', function () { setMode('ai'); });

  function setMode(mode) {
    currentMode = mode;
    modeFidelity.classList.toggle('active', mode === 'fidelity');
    modeAI.classList.toggle('active', mode === 'ai');
    modeFidelity.setAttribute('aria-checked', mode === 'fidelity');
    modeAI.setAttribute('aria-checked', mode === 'ai');
    if (mode === 'ai') {
      modeHint.textContent = 'AI 重建缺失细节，把小图、模糊图变成真正的高清图；首次使用需下载约 4MB 模型。';
    } else {
      modeHint.textContent = '仅按比例放大，不补造细节、不改变原图元素，无需联网。';
    }
  }
  setMode('ai');

  tierSelect.addEventListener('change', function () {
    if (sourceImage) updateTierHint();
  });

  function updateTierHint() {
    if (!sourceImage) return;
    var targetLong = parseInt(tierSelect.value, 10);
    var t = computeTarget(sourceImage.naturalWidth, sourceImage.naturalHeight, targetLong);
    if (t.already) {
      tierHint.textContent = '原图较长边 ' + sourceImage.naturalWidth + 'px，已不低于该清晰度。';
    } else {
      tierHint.textContent = '输出约 ' + t.w + ' × ' + t.h + ' px（保持原比例）。';
    }
  }

  formatSelect.addEventListener('change', function () {
    jpegField.hidden = formatSelect.value !== 'jpeg';
  });
  qualityRange.addEventListener('input', function () {
    qualityValue.textContent = qualityRange.value + '%';
  });

  /* ---------- 处理 ---------- */

  processBtn.addEventListener('click', runProcess);

  function computeTarget(sw, sh, long) {
    var s = long / Math.max(sw, sh);
    if (s <= 1) {
      return { w: sw, h: sh, scale: 1, already: true };
    }
    return { w: Math.round(sw * s), h: Math.round(sh * s), scale: s, already: false };
  }

  function runProcess() {
    if (!sourceImage) { setStatus('请先选择图片', 'error'); return; }
    var targetLong = parseInt(tierSelect.value, 10);
    var label = TIER_LABELS[targetLong] || targetLong;
    var target = computeTarget(sourceImage.naturalWidth, sourceImage.naturalHeight, targetLong);

    processBtn.disabled = true;
    downloadBtn.disabled = true;

    if (target.already) {
      resultCanvas = imageToCanvas(sourceImage);
      finishResult('原图已不低于 ' + label + '，无需放大', null);
      return;
    }

    if (currentMode === 'fidelity') {
      setStatus('正在无损放大到 ' + label + '…', 'info');
      nextFrame().then(function () {
        try {
          resultCanvas = fidelityToTarget(sourceImage, target);
          finishResult('已生成 ' + label + ' 高清图', null);
        } catch (err) {
          console.error(err);
          setStatus('处理失败：' + err.message, 'error');
          processBtn.disabled = false;
        }
      });
    } else {
      runAI(target, label);
    }
  }

  function finishResult(msg, extra) {
    buildOrigScaled();
    showResult();
    setStatus(msg, 'ok');
    downloadBtn.disabled = false;
    processBtn.disabled = false;
    renderDimensions(extra);
  }

  function showResult() {
    if (!resultCanvas) return;
    resultPreview.src = resultCanvas.toDataURL('image/png');
    resultPreview.hidden = false;
    previewPlaceholder.hidden = true;
  }

  function buildOrigScaled() {
    if (!sourceImage || !resultCanvas) return;
    var c = document.createElement('canvas');
    c.width = resultCanvas.width;
    c.height = resultCanvas.height;
    var ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(sourceImage, 0, 0, c.width, c.height);
    origScaled = c;
  }

  function renderDimensions() {
    if (!sourceImage) { dimensionsInfo.textContent = ''; return; }
    var text = '原图 ' + sourceImage.naturalWidth + ' × ' + sourceImage.naturalHeight + ' px';
    if (resultCanvas) text += '  →  高清 ' + resultCanvas.width + ' × ' + resultCanvas.height + ' px';
    dimensionsInfo.textContent = text;
  }

  /* ---------- 无损放大（Lanczos） ---------- */

  function fidelityToTarget(img, target) {
    var w = target.w;
    var h = target.h;
    var MAX_DIM = 8192;
    if (w > MAX_DIM || h > MAX_DIM) {
      throw new Error('输出尺寸过大（' + w + '×' + h + ' px），请选择更低清晰度');
    }
    var sw = img.naturalWidth;
    var sh = img.naturalHeight;
    var canvas;
    if (w * h > 12000000) {
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
    unsharpMask(canvas.getContext('2d', { willReadFrequently: true }), w, h, 0.3, 1);
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

  /* ---------- AI 高清（ESRGAN 整数倍放大链） ---------- */

  function runAI(target, label) {
    setStatus('正在加载 AI 模型（首次使用需下载约 4MB）…', 'info');
    nextFrame().then(function () {
      return ensureAIUpscaler();
    }).then(function () {
      setStatus('AI 正在重建细节并放大到 ' + label + '…', 'info');
      return nextFrame().then(function () {
        return aiToTarget(sourceImage, target);
      });
    }).then(function (canvas) {
      resultCanvas = canvas;
      finishResult('已生成 ' + label + ' 高清图', {});
    }).catch(function (err) {
      console.error(err);
      var msg = err && err.message ? err.message : '未知错误';
      setStatus('AI 模型加载失败，已改用无损放大（原因：' + msg + '）', 'info');
      setMode('fidelity');
      try {
        resultCanvas = fidelityToTarget(sourceImage, target);
        finishResult('已改用无损放大完成', null);
      } catch (e2) {
        setStatus('处理失败：' + e2.message, 'error');
        processBtn.disabled = false;
      }
    });
  }

  function aiFactors(required) {
    var factors = [];
    var acc = 1;
    var opts = [4, 3, 2];
    while (acc < required) {
      var remaining = required / acc;
      var f = null;
      for (var i = 0; i < opts.length; i++) {
        if (opts[i] >= remaining) f = opts[i];
      }
      if (!f) f = 4;
      factors.push(f);
      acc *= f;
      if (acc >= 64) break;
    }
    return factors;
  }

  function aiToTarget(img, target) {
    var factors = aiFactors(target.scale);
    var cur = Promise.resolve(imageToCanvas(img));
    for (var i = 0; i < factors.length; i++) {
      cur = cur.then((function (factor) {
        return function (canvas) { return aiUpscaleOnce(canvas, factor); };
      })(factors[i]));
    }
    return cur.then(function (hiCanvas) {
      if (hiCanvas.width === target.w && hiCanvas.height === target.h) return hiCanvas;
      var out = document.createElement('canvas');
      out.width = target.w;
      out.height = target.h;
      var ctx = out.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(hiCanvas, 0, 0, target.w, target.h);
      return out;
    });
  }

  function aiUpscaleOnce(canvas, factor) {
    var modelGlobal = AI_MODEL_GLOBALS[factor];
    var modelUrl = AI_LIBS.models[factor];
    return loadScript(modelUrl).then(function () {
      var model = window[modelGlobal];
      if (!model) throw new Error('模型脚本加载失败');
      model.path = 'models/x' + factor + '/model.json';
      if (!aiUpscalers[factor]) {
        aiUpscalers[factor] = new aiState.upscaler({ model: model });
      }
      var upscaler = aiUpscalers[factor];
      var maxDim = Math.max(canvas.width, canvas.height);
      var patchByScale = { 2: 128, 3: 129, 4: 128 };
      var options = maxDim > 800 ? { patchSize: patchByScale[factor] || 128, padding: 8 } : {};
      return upscaler.upscale(canvas, options);
    }).then(function (result) {
      return toCanvas(result);
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

  /* ---------- 放大镜对比预览 ---------- */

  var LOUPE_SIZE = 260;
  var ZOOM = 3;

  function onPreviewMove(e) {
    if (!resultCanvas || !origScaled) return;
    var rect = resultPreview.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    var imgX = (e.clientX - rect.left) / rect.width * resultCanvas.width;
    var imgY = (e.clientY - rect.top) / rect.height * resultCanvas.height;
    drawLoupe(imgX, imgY);
    var wrapRect = previewWrap.getBoundingClientRect();
    var lx = e.clientX - wrapRect.left - LOUPE_SIZE / 2;
    var ly = e.clientY - wrapRect.top - LOUPE_SIZE / 2;
    lx = clamp(lx, 0, Math.max(0, wrapRect.width - LOUPE_SIZE));
    ly = clamp(ly, 0, Math.max(0, wrapRect.height - LOUPE_SIZE));
    loupe.style.left = lx + 'px';
    loupe.style.top = ly + 'px';
    loupe.hidden = false;
  }

  function drawLoupe(imgX, imgY) {
    var cw = resultCanvas.width;
    var ch = resultCanvas.height;
    var crop = LOUPE_SIZE / ZOOM;
    if (cw < crop || ch < crop) { loupe.hidden = true; return; }
    var cx = clamp(imgX - crop / 2, 0, cw - crop);
    var cy = clamp(imgY - crop / 2, 0, ch - crop);
    var ctx = loupe.getContext('2d');
    var half = LOUPE_SIZE / 2;
    ctx.clearRect(0, 0, LOUPE_SIZE, LOUPE_SIZE);
    ctx.drawImage(origScaled, cx, cy, crop, crop, 0, 0, half, LOUPE_SIZE);
    ctx.drawImage(resultCanvas, cx, cy, crop, crop, half, 0, half, LOUPE_SIZE);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(half - 1, 0, 2, LOUPE_SIZE);
    ctx.fillStyle = 'rgba(17, 24, 39, 0.6)';
    ctx.fillRect(0, 0, half, 20);
    ctx.fillRect(half, 0, half, 20);
    ctx.fillStyle = '#ffffff';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('原图', half / 2, 14);
    ctx.fillText('高清', half + half / 2, 14);
  }

  previewWrap.addEventListener('pointermove', onPreviewMove);
  previewWrap.addEventListener('pointerleave', function () { loupe.hidden = true; });

  /* ---------- 下载 ---------- */

  downloadBtn.addEventListener('click', function () {
    if (!resultCanvas) return;
    var format = formatSelect.value;
    var mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
    var quality = format === 'jpeg' ? parseInt(qualityRange.value, 10) / 100 : undefined;
    var dataUrl = resultCanvas.toDataURL(mime, quality);
    var ext = format === 'jpeg' ? 'jpg' : 'png';
    var a = document.createElement('a');
    a.href = dataUrl;
    a.download = sourceFileName + '-' + resultCanvas.width + 'x' + resultCanvas.height + '.' + ext;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });
})();
