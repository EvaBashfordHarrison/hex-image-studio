(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // DOM references and application state
  // ---------------------------------------------------------------------------

  const $ = (id) => document.getElementById(id);
  const preview = $('preview');
  const previewContext = preview.getContext('2d');

  const CONTROL_IDS = [
    'spacing', 'maxSize', 'cutoff', 'brightness', 'contrast', 'black', 'white',
    'bleed', 'jitter', 'variation', 'warp', 'warpSize', 'clump',
  ];

  const DEFAULTS = {
    spacing: 6,
    maxSize: 100,
    cutoff: 4,
    brightness: 0,
    contrast: 0,
    black: 0,
    white: 100,
    bleed: 0,
    jitter: 0,
    variation: 0,
    warp: 0,
    warpSize: 100,
    clump: 0,
    shape: 0,
    ink: '#000000',
    background: true, // is checked
    width: 1080,
    height: 1080,
    // dpi: 300,
    // units: 'px',
    imageFit: 'contain',
    zoom: 100,
    posX: 50,
    posY: 50, 
    text: 'TESTER WORD',
    textSize: 25,
    textGradient: 50,
    bgGrey: 50,
    bgStrength: 100,
    bgTexture: 'noise',
    bgNoiseScale: 50,
  };


// Values are written into the matching control IDs.
  const LOOK_PRESETS = {
    // Image mode
    portraitSmall: {
      spacing: 15,
      maxSize: 100,
      bleed: 15,
      variation: 10,
      clump: 10,
    },
    portraitBig: {
      spacing: 6,
      maxSize: 100,
      bleed: 35,
      jitter: 7,
      variation: 6,
    },

    // Type mode
    type1: {
      textSize: 100,
      textGradient: 85,
      brightness: -50,
      spacing: 7,
      maxSize: 90,
      bleed: 35,
      jitter: 7,
      variation: 6,
      warp: 30,
      clump: 10,
    },
    type2: {
      textSize: 100,
      textGradient: 30,
      brightness: -50,
      spacing: 7,
      maxSize: 90,
      bleed: 25,
      jitter: 0,
      variation: 5,
      warp: 0,
      clump: 20,
    },
    type3: {
      textSize: 100,
      textGradient: 15,
      brightness: -100,
      spacing: 7,
      maxSize: 90,
      bleed: 0,
      jitter: 7,
      variation: 10,
      warp: 0,
      clump: 45,
    },

    // Background mode (texture only, for now)
    bgNoise: {
      bgTexture: 'noise',
    },
    bgGradient: {
      bgTexture: 'gradient',
    },
  };

  const PREVIEW_MAX_DIMENSION = 1200;
  const PNG_WARNING_PIXELS = 50_000_000;
  const SVG_WARNING_PIXELS = 20_000_000;
  const MAX_CANVAS_DIMENSION = 32767;
  const DPI = 300;


  let sourceImage = null;
  let renderTimer = null;
  let imageLoadToken = 0;

  let mode = 'image'; // 'image' | 'text'
  // let customFontFamily = null;
  // let fontCounter = 0;

  // ---------------------------------------------------------------------------
  // UTILITY FUNCTIONS
  // ---------------------------------------------------------------------------
    
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function readNumber(id, fallback) {
    const value = Number($(id).value);
    return Number.isFinite(value) ? value : fallback;
  }

  
  function seededRandom(x, y, seed = 0) {
    const value = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
    return value - Math.floor(value);
  }

  function organicNoise(x, y, seed = 0) {
    const a = Math.sin(x * 0.31 + y * 0.17 + seed);
    const b = Math.cos(y * 0.23 - x * 0.11 + seed * 1.7);
    const c = Math.sin((x + y) * 0.09 + seed * 0.7);

    return a * b * 0.65 + c * 0.35;
  }

  function getBackgroundColour() {
    if (mode === 'background') return '#ffffff';

    return $('background').checked ? '#ffffff' : null;
  }

  function updatePreviewBackdrop() {
    preview.classList.toggle(
      'is-transparent',
      !$('background').checked
    );
  }

  function updateStatus(id, message) {
    $(id).textContent = message;
  }

  function getDocumentSize() {
    const width = readNumber('width', NaN);
    const height = readNumber('height', NaN);

    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return {
        valid: false,
        message: 'Enter a width and height greater than zero.'
      };
    }

    if (width > 12000 || height > 12000) {
      return {
        valid: false,
        message: 'Document width and height cannot exceed 12,000 px.'
      };
    }

    const roundedWidth = Math.round(width);
    const roundedHeight = Math.round(height);

    if (roundedWidth < 1 || roundedHeight < 1) {
      return {
        valid: false,
        message: 'Enter a width and height greater than zero.'
      };
    }

    return {
      valid: true,
      width: roundedWidth,
      height: roundedHeight,
      // dpi: DPI,
      // units: 'px'
    };
  }

function updateDimensionLabel() {
    syncPresetWithDimensions();

    const documentSize = getDocumentSize();
    const label = $('dimensionLabel');

    if (!documentSize.valid) {
      label.textContent = 'Invalid dimensions';
      updateStatus('previewStatus', documentSize.message);

      $('exportPng').disabled = true;
      $('exportSvg').disabled = true;

      return;
    }

    label.textContent =
      `${documentSize.width.toLocaleString()} × ${documentSize.height.toLocaleString()} px`;

    const hasImage = hasSource();

    $('exportPng').disabled = !hasImage;
    $('exportSvg').disabled = !hasImage;

    scheduleRender();
  }

  // ---------------------------------------------------------------------------
  // CANVAS SIZE PRESETS
  // ---------------------------------------------------------------------------

  const presetInputs = document.querySelectorAll('input[name="canvas-size"]');

  // Sets the document to a preset size in pixels.
  function applyPreset(value) {
    const [width, height] = value.split('x');

    // $('units').value = 'px';
    $('width').value = width;
    $('height').value = height;

    updateDimensionLabel(); // also re-syncs the radio buttons
  }

  // Highlights the matching preset, or clears all of them if the size is custom.
  // function syncPresetWithDimensions() {
  //   const key = `${Number($('width').value)}x${Number($('height').value)}`;
  //   const isPixels = $('units').value === 'px';

  //   presetInputs.forEach((input) => {
  //     input.checked = isPixels && input.value === key;
  //   });
  // }

  function syncPresetWithDimensions() {
    const key = `${Number($('width').value)}x${Number($('height').value)}`;

    presetInputs.forEach((input) => {
      input.checked = input.value === key;
    });
  }

  function updateControlLabels() {
    CONTROL_IDS.forEach((id) => {
      const value = $(id).value;
      let suffix = '';

      if (id === 'spacing' || id === 'grainSize') {
        suffix = ' px';
      } else if (
        [
          'maxSize',
          'cutoff',
          'bleed',
          'jitter',
          'variation',
          'warp',
          'warpSize',
          'clump',
        ].includes(id)
      ) {
        suffix = '%';
      }

      $(`${id}Val`).textContent = `${value}${suffix}`;
    });

    $('zoomVal').textContent = `${$('zoom').value}%`;
    $('posXVal').textContent = `${$('posX').value}%`;
    $('posYVal').textContent = `${$('posY').value}%`;
    $('textSizeVal').textContent = `${$('textSize').value}%`;
    $('textGradientVal').textContent = `${$('textGradient').value}%`;
    $('bgGreyVal').textContent = `${$('bgGrey').value}%`;
    $('bgStrengthVal').textContent = `${$('bgStrength').value}%`;
    $('bgNoiseScaleVal').textContent = `${$('bgNoiseScale').value}%`;
  }

function scheduleRender() {
  updateControlLabels();
  updatePreviewBackdrop();

  if (!hasSource()) return;

  clearTimeout(renderTimer);

  renderTimer = setTimeout(() => {
    try {
      renderPreview();
    } catch (error) {
      console.error('Preview render failed:', error);
      updateStatus(
        'previewStatus',
        'Preview could not be rendered. Try reducing the document size.'
      );
    }
  }, 35);
}

  // Generates the grey texture that drives hexagon sizes in Background Mode.
function drawBackgroundTexture(context, width, height) {
  const grey = clamp(readNumber('bgGrey', 50), 0, 100) / 100;
  const strength = (readNumber('bgStrength', 50) / 100) * 0.35;
  const lift = readNumber('brightness', 0) / 100;
  const textureType = $('bgTexture').value;

  // Noise scale: 0% = blobs about 5% of the longer side,
  // 100% = blobs 1.5x the longer side (one or two on screen).
  // Exponential mapping keeps the middle of the slider feeling even.
  const scaleAmount = clamp(readNumber('bgNoiseScale', 50), 0, 100) / 100;
  const longestSide = Math.max(width, height);
  const minCell = longestSide * 0.05;
  const maxCell = longestSide * 1.5;
  const noiseCell = minCell * Math.pow(maxCell / minCell, scaleAmount);

  const image = context.createImageData(width, height);
  const data = image.data;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let variation;

      if (textureType === 'gradient') {
        // Diagonal ramp from -1 to +1.
        variation =
          (x / Math.max(1, width - 1)) +
          (y / Math.max(1, height - 1)) - 1;
      } else {
        // Smooth blobs from -1 to +1.
        variation = valueNoise(x, y, noiseCell, 5) * 2 - 1;
      }

      const tone = clamp(grey + lift + variation * strength, 0, 1);
      const value = Math.round(tone * 255);
      const i = (y * width + x) * 4;

      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    }
  }

  context.putImageData(image, 0, 0);
}

  // Smooth value noise: random values on a lattice of `cell` pixels,
// blended with a smoothstep curve. Returns 0..1.
function valueNoise(x, y, cell, seed = 0) {
  const gx = x / cell;
  const gy = y / cell;

  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);

  const fx = gx - x0;
  const fy = gy - y0;

  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);

  const v00 = seededRandom(x0, y0, seed);
  const v10 = seededRandom(x0 + 1, y0, seed);
  const v01 = seededRandom(x0, y0 + 1, seed);
  const v11 = seededRandom(x0 + 1, y0 + 1, seed);

  const top = v00 + (v10 - v00) * ux;
  const bottom = v01 + (v11 - v01) * ux;

  return top + (bottom - top) * uy;
}

  // ---------------------------------------------------------------------------
  // TEXT LOADING
  // ---------------------------------------------------------------------------
  function hasSource() {
    if (mode === 'background') return true;
    if (mode === 'text') return $('text').value.trim().length > 0;
    return Boolean(sourceImage);
  }

// Equivalent of your p5 pg.text(...) buffer.
// Size is a % of canvas height, so preview and full-res export match.
function drawTextSource(context, width, height) {
  const fontFamily = '"Baskov", Georgia, serif';
  const lines = $('text').value.split('\n');

  // --- Fit the text to the canvas ---
  let size = height * (readNumber('textSize', DEFAULTS.textSize) / 100);
  context.font = `${size}px ${fontFamily}`;

  let widest = Math.max(...lines.map((l) => context.measureText(l).width));
  const maxWidth = width * 0.9;

  if (widest > maxWidth) {
    size *= maxWidth / widest;
    context.font = `${size}px ${fontFamily}`;
    widest = Math.max(...lines.map((l) => context.measureText(l).width));
  }

  // --- Grey background, driven by the Brightness slider ---
  // Brightness -100 -> white (no hexagons); +100 -> near-black (almost matches the type).
  const amount = (readNumber('brightness', 0) + 100) / 200;
  const backgroundTone = 1 - amount * 0.92;
  const bg = Math.round(backgroundTone * 255);

  context.fillStyle = `rgb(${bg},${bg},${bg})`;
  context.fillRect(0, 0, width, height);

  // --- Type gradient: black on the left fading to a lighter grey on the right ---
  // The light end is capped so the type never becomes lighter than the background.
  const strength = readNumber('textGradient', DEFAULTS.textGradient) / 100;
  const lightTone = Math.min(strength * 0.3, Math.max(0, backgroundTone - 0.03));
  const light = Math.round(lightTone * 255);

  const gradient = context.createLinearGradient(
    width / 2 - widest / 2, 0,
    width / 2 + widest / 2, 0
  );
  gradient.addColorStop(0, '#000000');
  gradient.addColorStop(1, `rgb(${light},${light},${light})`);

  // --- Draw the text ---
  const lineHeight = size * 0.9;
  const top = height / 2 - ((lines.length - 1) * lineHeight) / 2;

  context.fillStyle = gradient;
  context.textAlign = 'center';
  context.textBaseline = 'middle';

  lines.forEach((line, i) => {
    context.fillText(line, width / 2, top + i * lineHeight);
  });
}

// async function loadFontFile(file) {
//   if (!file) return;
//   try {
//     const name = `UserFont${++fontCounter}`;
//     const face = new FontFace(name, await file.arrayBuffer());
//     await face.load();
//     document.fonts.add(face);
//     customFontFamily = name;
//     scheduleRender();
//   } catch (error) {
//     console.error('Font load failed:', error);
//     updateStatus('previewStatus', 'Could not load that font file.');
//   }
// }

function setMode(next) {
  mode = next;

  $('imageMode').classList.toggle('active', mode === 'image');
  $('typeMode').classList.toggle('active', mode === 'text');
  $('backgroundMode').classList.toggle('active', mode === 'background');

  const modeLabels = {
    image: 'Image Mode',
    text: 'Type Mode',
    background: 'Background Mode'
  };
  $('modeName').textContent = modeLabels[mode] || 'Image Mode';

  document.querySelectorAll('[data-mode]').forEach((el) => {
    el.hidden = !el.dataset.mode.split(' ').includes(mode);
  });

  document.querySelectorAll('[data-hide-in]').forEach((el) => {
    el.hidden = el.dataset.hideIn.split(' ').includes(mode);
  });

  const ready = hasSource();
  $('empty').hidden = ready;
  preview.hidden = !ready;

  updateDimensionLabel(); // also schedules a render
}

  // ---------------------------------------------------------------------------
  // IMG LOADING
  // ---------------------------------------------------------------------------
  function loadImage(file) {
    if (!file) return;

    const supportedTypes = [
      'image/jpeg',
      'image/png',
      'image/webp'
    ];

    if (!supportedTypes.includes(file.type)) {
      updateStatus('fileStatus', 'Please choose a JPG, PNG or WebP image.');
      $('file').value = '';
      return;
    }

    const token = ++imageLoadToken;
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);

      if (token !== imageLoadToken) return;

      sourceImage = image;

      $('empty').hidden = true;
      preview.hidden = false;
      $('fitBtn').disabled = false;

      updateStatus(
        'fileStatus',
        `${image.naturalWidth.toLocaleString()} × ${image.naturalHeight.toLocaleString()} px`
      );

      updateStatus('previewStatus', 'Live preview');

      updateDimensionLabel();
      renderPreview();
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);

      if (token !== imageLoadToken) return;

      updateStatus(
        'fileStatus',
        'Could not read that image. Try another file.'
      );

      $('file').value = '';
    };

    image.src = objectUrl;
  }

  // Draw the source image into the output-sized sampling canvas.
function getSourceImageData(width, height) {
    const canvas = document.createElement('canvas');

    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d', {
      willReadFrequently: true
    });

    if (!context) {
      throw new Error('Canvas image processing is unavailable in this browser.');
    }

    if (mode === 'background') {
      // Writes the grey + noise/gradient texture directly into the pixel data.
      drawBackgroundTexture(context, width, height);
      return context.getImageData(0, 0, width, height);
    }

    const background = getBackgroundColour();

    if (background) {
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);
    }

    if (mode === 'text') {
      drawTextSource(context, width, height);
    } else if (sourceImage) {
      const fit = $('imageFit').value;

      const baseScale = fit === 'cover'
        ? Math.max(
            width / sourceImage.width,
            height / sourceImage.height
          )
        : Math.min(
            width / sourceImage.width,
            height / sourceImage.height
          );

      const scale = baseScale * (readNumber('zoom', 100) / 100);

      const drawWidth = sourceImage.width * scale;
      const drawHeight = sourceImage.height * scale;

      const offsetX =
        (width - drawWidth) * (readNumber('posX', 50) / 100);

      const offsetY =
        (height - drawHeight) * (readNumber('posY', 50) / 100);

      context.drawImage(
        sourceImage,
        offsetX,
        offsetY,
        drawWidth,
        drawHeight
      );
    }

    return context.getImageData(0, 0, width, height);
  }

  // ---------------------------------------------------------------------------
  // TONE MAPPING & HEXAGON GEOMETRY
  // ---------------------------------------------------------------------------

  function getAdjustedLuminance(pixelData, index) {
    const alpha = pixelData[index + 3] / 255;

    const red =
      pixelData[index] * alpha + 255 * (1 - alpha);

    const green =
      pixelData[index + 1] * alpha + 255 * (1 - alpha);

    const blue =
      pixelData[index + 2] * alpha + 255 * (1 - alpha);

    let luminance =
      (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;

    if (mode === 'text' || mode === 'background') return luminance;

    const brightness = readNumber('brightness', 0);

    luminance = clamp(
      luminance + brightness / 100,
      0,
      1
    );

    const contrast = readNumber('contrast', 0);

    const contrastFactor =
      (259 * (contrast + 255)) / (255 * (259 - contrast));

    luminance = clamp(
      (contrastFactor * (luminance * 255 - 128) + 128) / 255,
      0,
      1
    );

    const blackPoint = readNumber('black', 0) / 100;
    const whitePoint = readNumber('white', 100) / 100;

    return whitePoint > blackPoint
      ? clamp(
          (luminance - blackPoint) / (whitePoint - blackPoint),
          0,
          1
        )
      : luminance <= blackPoint ? 0 : 1;
  }

  function getHexagonPoints(
  centerX,
  centerY,
  radius,
  seed = 0,
  roughness = 0
) {
  const points = [];

  for (let index = 0; index < 6; index += 1) {
    // Pointy-top: first vertex at -30°, so vertices sit at top and bottom
    const angle = (Math.PI / 3) * index - Math.PI / 6;

    const variation =
      Math.sin(seed * 12.9898 + index * 78.233) * 43758.5453;

    const random = variation - Math.floor(variation);

    const adjustedRadius =
      radius * (1 + (random - 0.5) * roughness);

    points.push([
      centerX + adjustedRadius * Math.cos(angle),
      centerY + adjustedRadius * Math.sin(angle)
    ]);
  }

  return points;
}

function drawHexagon(context, hexagon, colour) {
  if (hexagon.radius <= 0.15) return;

  const points = getHexagonPoints(
    hexagon.x,
    hexagon.y,
    hexagon.radius,
    hexagon.seed,
    hexagon.roughness
  );

  context.beginPath();
  context.moveTo(points[0][0], points[0][1]);

  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index][0], points[index][1]);
  }

  context.closePath();
  context.fillStyle = colour;
  context.fill();
}

function generateHexagons(width, height, scale = 1) {
  const imageData = getSourceImageData(width, height);
  const pixels = imageData.data;

  const spacing = readNumber('spacing', DEFAULTS.spacing) * scale;

  const maximumRadius =
    spacing * 0.5 * (readNumber('maxSize', DEFAULTS.maxSize) / 100);

  const cutoff = readNumber('cutoff', DEFAULTS.cutoff) / 100;

  const bleed = readNumber('bleed', 0) / 100;
  const jitter = readNumber('jitter', 0) / 100;
  const variation = readNumber('variation', 0) / 100;
  const warp = readNumber('warp', 0) / 100;
  const warpScale = readNumber('warpSize', 100) / 100;
  const clump = readNumber('clump', 0) / 100;

  // Warp size scales the noise grid. Larger values give bigger, smoother patches.
  const warpGrid = spacing * warpScale;

  const stepX = spacing * Math.sqrt(3) / 2;
  const stepY = spacing * 0.75;

  const columns = Math.ceil(width / stepX) + 3;
  const rows = Math.ceil(height / stepY) + 3;

  const hexagons = [];

  for (let row = -1; row < rows; row += 1) {
    const centerY = row * stepY + stepY / 2;

    // Every other row shifts right by half a column.
    // (row & 1) stays correct for the -1 starting row, unlike row % 2.
    const rowOffset = (row & 1) ? stepX / 2 : 0;

    for (let column = -1; column < columns; column += 1) {
      const centerX = column * stepX + stepX / 2 + rowOffset;

      if (
        centerX < -spacing ||
        centerY < -spacing ||
        centerX > width + spacing ||
        centerY > height + spacing
      ) {
        continue;
      }

      const sampleX = clamp(Math.round(centerX), 0, width - 1);
      const sampleY = clamp(Math.round(centerY), 0, height - 1);

      const pixelIndex = (sampleY * width + sampleX) * 4;

      const darkness =
        1 - getAdjustedLuminance(pixels, pixelIndex);

      if (darkness <= cutoff) continue;

      const tone = (darkness - cutoff) / (1 - cutoff || 1);

      const baseRadius =
        maximumRadius * Math.sqrt(clamp(tone, 0, 1));

      const seed = row * 10000 + column;

      const offsetX =
        (seededRandom(row, column, 1) - 0.5) *
        spacing * 0.35 * jitter;

      const offsetY =
        (seededRandom(row, column, 2) - 0.5) *
        spacing * 0.35 * jitter;

      const warpX =
        organicNoise(centerX / warpGrid, centerY / warpGrid, 11) *
        spacing * 0.55 * warp;

      const warpY =
        organicNoise(centerX / warpGrid, centerY / warpGrid, 29) *
        spacing * 0.55 * warp;

      const clumpField = Math.max(
        0,
        organicNoise(
          centerX / spacing * 0.5,
          centerY / spacing * 0.5,
          43
        )
      );

      const clumpFactor = 1 + clumpField * clump * 0.85;

      const sizeFactor =
        1 + (seededRandom(row, column, 3) - 0.5) * 0.5 * variation;

      const radius =
        baseRadius * sizeFactor * clumpFactor +
        bleed * spacing * 0.1;

      const roughness =
        // Math.min(0.6, bleed * 0.18 + shape * 0.35);
        Math.min(0.6, bleed * 0.18 * 0.35);

      if (radius > 0.15) {
        hexagons.push({
          x: centerX + offsetX + warpX,
          y: centerY + offsetY + warpY,
          radius,
          seed,
          roughness
        });
      }
    }
  }

  return {
    hexagons,
    colour: $('ink').value
  };
}

function load_text() {
  
}

  // ---------------------------------------------------------------------------
  // INK TEXTURE
  // ---------------------------------------------------------------------------

  // function generateGrainMarks(width, height, scale = 1) {
  //   const amount = readNumber('grain', 0) / 100;
  //   const size = readNumber('grainSize', DEFAULTS.grainSize) * scale;

  //   if (amount <= 0) return [];

  //   // Keep texture density bounded for large documents.
  //   const cellSize = Math.max(
  //     0.5,
  //     size * 2.5,
  //     Math.sqrt((width * height) / 250000)
  //   );

  //   const columns = Math.ceil(width / cellSize);
  //   const rows = Math.ceil(height / cellSize);

  //   const marks = [];

  //   for (let row = 0; row < rows; row += 1) {
  //     for (let column = 0; column < columns; column += 1) {
  //       if (seededRandom(column, row, 71) > amount * 0.65) {
  //         continue;
  //       }

  //       const x =
  //         (column + 0.5 +
  //           (seededRandom(column, row, 72) - 0.5) * 0.8) *
  //         cellSize;

  //       const y =
  //         (row + 0.5 +
  //           (seededRandom(column, row, 73) - 0.5) * 0.8) *
  //         cellSize;

  //       const radius =
  //         size * (0.2 + seededRandom(column, row, 74) * 0.3);

  //       marks.push({ x, y, radius });
  //     }
  //   }

  //   return marks;
  // }

  function createInkLayer(
    width,
    height,
    hexagons,
    colour,
    scale = 1
  ) {
    const layer = document.createElement('canvas');

    layer.width = width;
    layer.height = height;

    const context = layer.getContext('2d');

    if (!context) {
      throw new Error('Canvas rendering is unavailable in this browser.');
    }

    hexagons.forEach((hexagon) => {
      drawHexagon(context, hexagon, colour);
    });

    // const grainMarks = generateGrainMarks(width, height, scale);

    // if (grainMarks.length) {
    //   context.save();
    //   context.globalCompositeOperation = 'destination-out';

    //   grainMarks.forEach((mark) => {
    //     context.beginPath();
    //     context.arc(
    //       mark.x,
    //       mark.y,
    //       mark.radius,
    //       0,
    //       Math.PI * 2
    //     );
    //     context.fill();
    //   });

    //   context.restore();
    // }

    return layer;
  }

  function renderPreview() {
    if (!hasSource()) return;

    const documentSize = getDocumentSize();

    if (!documentSize.valid) return;

    const scale = Math.min(
      1,
      PREVIEW_MAX_DIMENSION /
        Math.max(documentSize.width, documentSize.height)
    );

    const width = Math.max(
      1,
      Math.round(documentSize.width * scale)
    );

    const height = Math.max(
      1,
      Math.round(documentSize.height * scale)
    );

    const result = generateHexagons(width, height, scale);

    preview.width = width;
    preview.height = height;

    if (!previewContext) {
      throw new Error('Canvas preview is unavailable in this browser.');
    }

    previewContext.clearRect(0, 0, width, height);

    const background = getBackgroundColour();

    if (background) {
      previewContext.fillStyle = background;
      previewContext.fillRect(0, 0, width, height);
    }

    const inkLayer = createInkLayer(
      width,
      height,
      result.hexagons,
      result.colour,
      scale   // renderPreview only; exportPng has no scale argument
    );

    previewContext.drawImage(inkLayer, 0, 0);

    updateStatus(
      'previewStatus',
      `${result.hexagons.length.toLocaleString()} hexagons · preview ${width.toLocaleString()} × ${height.toLocaleString()} px`
    );
  }

  // ---------------------------------------------------------------------------
  // SVG DOWNLOLADS
  // ---------------------------------------------------------------------------

  function formatPhysicalDimension(pixelDimension) {
    return `${(pixelDimension / DPI).toFixed(4)}in`;
  }

function createSvg(width, height, result) {
    const polygons = result.hexagons.map((hexagon) => {
      const points = getHexagonPoints(
        hexagon.x,
        hexagon.y,
        hexagon.radius,
        hexagon.seed,
        hexagon.roughness
      );

      const pointList = points
        .map((point) =>
          point.map((coordinate) => coordinate.toFixed(2)).join(',')
        )
        .join(' ');

      return `<polygon points="${pointList}"/>`;
    }).join('');

    const backgroundColour = getBackgroundColour();

    const background = backgroundColour
      ? `<rect width="${width}" height="${height}" fill="${backgroundColour}"/>`
      : '';

    const physicalWidth = formatPhysicalDimension(width);
    const physicalHeight = formatPhysicalDimension(height);

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${physicalWidth}" height="${physicalHeight}" viewBox="0 0 ${width} ${height}">
${background}
<g fill="${result.colour}">${polygons}</g>
</svg>`;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = filename;

    document.body.appendChild(link);
    link.click();
    link.remove();

    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function confirmLargeExport(pixelCount, threshold, format) {
    if (pixelCount <= threshold) return true;

    return window.confirm(
      `This is a large ${format} export and may use substantial memory or take some time. Continue?`
    );
  }

  function exportPng() {
    if (!hasSource()) return;

    const documentSize = getDocumentSize();

    if (!documentSize.valid) {
      updateStatus('exportStatus', documentSize.message);
      return;
    }

    const { width, height } = documentSize;

    if (!confirmLargeExport(width * height, PNG_WARNING_PIXELS, 'PNG')) {
      return;
    }

    updateStatus('exportStatus', 'Rendering full-resolution PNG…');

    window.setTimeout(() => {
      let canvas;

      try {
        canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const context = canvas.getContext('2d');

        if (!context) {
          throw new Error('Canvas rendering is unavailable in this browser.');
        }

        const result = generateHexagons(width, height);
        const background = getBackgroundColour();

        if (background) {
          context.fillStyle = background;
          context.fillRect(0, 0, width, height);
        }

        const inkLayer = createInkLayer(
          width,
          height,
          result.hexagons,
          result.colour
        );

        context.drawImage(inkLayer, 0, 0);

        canvas.toBlob((blob) => {
          if (!blob) {
            updateStatus(
              'exportStatus',
              'PNG export failed. Try a smaller document.'
            );
          } else {
            downloadBlob(blob, 'hex-halftone.png');

            updateStatus(
              'exportStatus',
              `PNG exported · ${width.toLocaleString()} × ${height.toLocaleString()} px`
            );
          }

          // Release the temporary canvas after encoding.
          canvas.width = 0;
          canvas.height = 0;
        }, 'image/png');

      } catch (error) {
        console.error('PNG export failed:', error);

        updateStatus(
          'exportStatus',
          `PNG export failed: ${error.message}`
        );

        if (canvas) {
          canvas.width = 0;
          canvas.height = 0;
        }
      }
    }, 30);
  }

  function exportSvg() {
    if (!hasSource()) return;

    const documentSize = getDocumentSize();

    if (!documentSize.valid) {
      updateStatus('exportStatus', documentSize.message);
      return;
    }

    const { width, height } = documentSize;

    if (!confirmLargeExport(width * height, SVG_WARNING_PIXELS, 'SVG')) {
      return;
    }

    updateStatus('exportStatus', 'Building vector SVG…');

    window.setTimeout(() => {
      try {
        const result = generateHexagons(width, height);
        const svg = createSvg(width, height, result);

        const blob = new Blob(
          [svg],
          { type: 'image/svg+xml;charset=utf-8' }
        );

        downloadBlob(blob, 'hex-halftone.svg');

        updateStatus(
          'exportStatus',
          'SVG exported · editable vector hexagons'
        );

      } catch (error) {
        console.error('SVG export failed:', error);

        updateStatus(
          'exportStatus',
          `SVG export failed: ${error.message}`
        );
      }
    }, 30);
  }

  // ---------------------------------------------------------------------------
  // COLOUR PICKER & EVENT LISTENERS ETC
  // ---------------------------------------------------------------------------

  // async function pickColour(target) {
  //   if (!window.EyeDropper) {
  //     window.alert(
  //       'Your browser does not support the eyedropper. Please use the colour picker instead.'
  //     );
  //     return;
  //   }

  //   try {
  //     const result = await new window.EyeDropper().open();

  //     if (target === 'ink') {
  //       $('ink').value = result.sRGBHex;
  //     } else if (target === 'background') {
  //       $('backgroundColor').value = result.sRGBHex;
  //       $('background').value = 'custom';
  //     }

  //     scheduleRender();

  //   } catch (error) {
  //     // Closing the eyedropper is a normal cancellation.
  //     if (error.name !== 'AbortError') {
  //       console.warn('Colour picker failed:', error);
  //     }
  //   }
  // }

  const colourButtons = document.querySelectorAll('.colour-options button');

  function syncColourButtons() {
    const current = $('ink').value.toLowerCase();

    colourButtons.forEach((button) => {
      button.classList.toggle(
        'active',
        button.dataset.colour.toLowerCase() === current
      );
    });

    $('inkPicker').value = current;

    // this means don't overwrite the field while the person is typing in it.
    if (document.activeElement !== $('inkHex')) {
      $('inkHex').value = current.toUpperCase();
    }
  }

  colourButtons.forEach((button) => {
    button.addEventListener('click', () => {
      $('ink').value = button.dataset.colour;
      syncColourButtons();
      scheduleRender();
    });
  });

  // Turns "fd0", "#FD0" or "ffd200" into "#ffd200". Returns null if invalid.
function normaliseHex(value) {
  let hex = value.trim().replace(/^#/, '').toLowerCase();

  if (/^[0-9a-f]{3}$/.test(hex)) {
    hex = hex.split('').map((c) => c + c).join('');
  }

  return /^[0-9a-f]{6}$/.test(hex) ? `#${hex}` : null;
}

function setInk(hex) {
  $('ink').value = hex;
  syncColourButtons();
  scheduleRender();
}

$('inkHex').addEventListener('input', (event) => {
  const hex = normaliseHex(event.target.value);
  if (hex) setInk(hex);
});

// On blur or Enter, tidy up or revert an invalid entry.
$('inkHex').addEventListener('change', () => {
  const hex = normaliseHex($('inkHex').value);
  if (hex) {
    setInk(hex);
  }
  $('inkHex').value = $('ink').value.toUpperCase();
});

$('inkPicker').addEventListener('input', (event) => {
  setInk(event.target.value);
});

  const fitButtons = document.querySelectorAll('.placement-options button');


function syncSegmented(groupName) {
  document
    .querySelectorAll(`.segmented[data-group="${groupName}"] button`)
    .forEach((button) => {
      button.classList.toggle('active', button.dataset.value === $(groupName).value);
    });
}

function setupSegmented(groupName) {
  document
    .querySelectorAll(`.segmented[data-group="${groupName}"] button`)
    .forEach((button) => {
      button.addEventListener('click', () => {
        $(groupName).value = button.dataset.value;
        syncSegmented(groupName);
        scheduleRender();
      });
    });
}


function syncFitButtons() {
  fitButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.fit === $('imageFit').value);
  });
}

fitButtons.forEach((button) => {
  button.addEventListener('click', () => {
    $('imageFit').value = button.dataset.fit;
    syncFitButtons();
    scheduleRender();
  });
});


function resetSettings() {
  Object.entries(DEFAULTS).forEach(([id, value]) => {
    const el = $(id);
    if (!el) return;

    if (el.type === 'checkbox') {
      el.checked = Boolean(value);
    } else {
      el.value = value;
    }
  });

  updateDimensionLabel();
  scheduleRender();
  syncColourButtons();
  syncFitButtons();
  syncSegmented('bgTexture');
}

  function applyLookPreset(key) {
    const preset = LOOK_PRESETS[key];
    if (!preset) return;

    Object.entries(preset).forEach(([id, value]) => {
      const el = $(id);
      if (el) el.value = value;
    });

    syncSegmented('bgTexture');
    scheduleRender();
  }

  $('file').addEventListener('change', (event) => {
    loadImage(event.target.files[0]);
  });

  // $('inkDropper').addEventListener('click', () => {
  //   pickColour('ink');
  // });

  // $('backgroundDropper').addEventListener('click', () => {
  //   pickColour('background');
  // });

  function on(id, eventName, handler) {
    const el = $(id);
    if (!el) {
      console.error(`Missing element with id "${id}" in the HTML`);
      return;
    }
    el.addEventListener(eventName, handler);
  }

  CONTROL_IDS.forEach((id) => on(id, 'input', scheduleRender));
  ['zoom', 'posX', 'posY', 'textSize', 'text', 'textGradient'].forEach((id) => on(id, 'input', scheduleRender));
  ['imageFit', 'background'].forEach((id) => on(id, 'change', scheduleRender));

  ['width', 'height'].forEach((id) => {
    on(id, 'input', updateDimensionLabel);
    on(id, 'change', updateDimensionLabel);
  });

  
  $('fitBtn').addEventListener('click', () => {
    $('imageFit').value = 'contain';
    syncFitButtons();
    $('zoom').value = 100;
    $('posX').value = 50;
    $('posY').value = 50;
    
    scheduleRender();
  });
  $('imageMode').addEventListener('click', () => setMode('image'));
  $('typeMode').addEventListener('click', () => setMode('text'));
  $('backgroundMode').addEventListener('click', () => setMode('background'));
  $('text').addEventListener('input', scheduleRender);
  $('textSize').addEventListener('input', scheduleRender);
  
  $('exportPng').addEventListener('click', exportPng);
  $('exportSvg').addEventListener('click', exportSvg);
  $('resetBtn').addEventListener('click', resetSettings);
  
  
  
  ['bgGrey', 'bgStrength', 'bgNoiseScale'].forEach((id) => on(id, 'input', scheduleRender));
  setupSegmented('bgTexture');
  document.querySelectorAll('[data-preset]').forEach((button) => {
    button.addEventListener('click', () => applyLookPreset(button.dataset.preset));
  });
  new FontFace('Baskov', 'url(BaskovRegular.otf)')
      .load()
      .then((face) => {
        document.fonts.add(face);
        scheduleRender();
      })
      .catch((error) => console.warn('Baskov failed to load:', error));

  updateControlLabels();

  presetInputs.forEach((input) => {
    input.addEventListener('change', () => applyPreset(input.value));
  });

  const initialPreset = document.querySelector('input[name="canvas-size"]:checked');

  if (initialPreset) {
    applyPreset(initialPreset.value);
  }

  updateDimensionLabel();
  syncColourButtons();
  syncFitButtons();
})();