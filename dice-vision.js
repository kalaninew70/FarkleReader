/**
 * Camera-based dice detection using OpenCV.js.
 *
 * Approach (runs once per "Capture" tap, not every video frame — this keeps
 * it fast and battery-friendly on a phone):
 *
 *  1. For each calibrated color (e.g. "Blue", "Red"), build an HSV color
 *     mask across the captured frame.
 *  2. Morphologically close that mask so each die becomes one solid blob,
 *     then find its outer contour ("die candidates"), filtered by size /
 *     squareness / solidity.
 *  3. Within each die's bounding box, look at the *raw* (unfilled) mask.
 *     A die's pips are a different color than its body, so they show up as
 *     holes in that color's mask. Count those holes (filtered by size and
 *     roundness, and required to sit inside the die's outline) to get the
 *     face value.
 *
 * This is a heuristic, not a trained model — lighting, glare, and touching
 * dice can confuse it. Detected values always come back with a confidence
 * flag, and the app's UI always lets the user tap to correct a result
 * before it's scored (see app.js).
 */
(function (global) {
  'use strict';

  // ---- Color profile helpers -------------------------------------------------

  // A profile is: { name, hue, sat, val, hueTol, satTol, valTol, lowSat }
  // hue/sat/val are the calibrated center values (OpenCV HSV: H 0-179).
  function sampleColorProfile(cv, mat, cx, cy, radius, name) {
    const hsv = new cv.Mat();
    cv.cvtColor(mat, hsv, cv.COLOR_RGBA2RGB);
    cv.cvtColor(hsv, hsv, cv.COLOR_RGB2HSV);

    const hues = [];
    const sats = [];
    const vals = [];
    const x0 = Math.max(0, cx - radius);
    const y0 = Math.max(0, cy - radius);
    const x1 = Math.min(hsv.cols - 1, cx + radius);
    const y1 = Math.min(hsv.rows - 1, cy + radius);

    for (let y = y0; y < y1; y += 2) {
      for (let x = x0; x < x1; x += 2) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy > radius * radius) continue;
        const pixel = hsv.ucharPtr(y, x);
        hues.push(pixel[0]);
        sats.push(pixel[1]);
        vals.push(pixel[2]);
      }
    }
    hsv.delete();

    if (hues.length === 0) return null;

    const median = (arr) => {
      const s = arr.slice().sort((a, b) => a - b);
      return s[Math.floor(s.length / 2)];
    };

    const satCenter = median(sats);
    const valCenter = median(vals);
    const lowSat = satCenter < 55;

    return {
      name,
      hue: median(hues),
      sat: satCenter,
      val: valCenter,
      hueTol: 12,
      satTol: 70,
      valTol: 70,
      lowSat,
    };
  }

  // Builds a binary mask (CV_8UC1, 0/255) matching a color profile. Handles
  // hue wraparound (e.g. red sits near both 0 and 179).
  function maskForProfile(cv, hsvMat, profile) {
    const satLow = profile.lowSat ? 0 : Math.max(0, profile.sat - profile.satTol);
    const satHigh = 255;
    const valLow = Math.max(0, profile.val - profile.valTol);
    const valHigh = Math.min(255, profile.val + profile.valTol);

    if (profile.lowSat) {
      // Hue is meaningless at low saturation (black/white/gray dice) — match
      // on value+low-saturation only.
      const low = new cv.Mat(hsvMat.rows, hsvMat.cols, hsvMat.type(), [0, 0, valLow, 0]);
      const high = new cv.Mat(
        hsvMat.rows,
        hsvMat.cols,
        hsvMat.type(),
        [179, Math.min(255, profile.sat + profile.satTol), valHigh, 255]
      );
      const mask = new cv.Mat();
      cv.inRange(hsvMat, low, high, mask);
      low.delete();
      high.delete();
      return mask;
    }

    let hLow = profile.hue - profile.hueTol;
    let hHigh = profile.hue + profile.hueTol;
    const mask = new cv.Mat.zeros(hsvMat.rows, hsvMat.cols, cv.CV_8UC1);

    const addRange = (lo, hi) => {
      const low = new cv.Mat(hsvMat.rows, hsvMat.cols, hsvMat.type(), [lo, satLow, valLow, 0]);
      const high = new cv.Mat(hsvMat.rows, hsvMat.cols, hsvMat.type(), [hi, satHigh, valHigh, 255]);
      const part = new cv.Mat();
      cv.inRange(hsvMat, low, high, part);
      cv.bitwise_or(mask, part, mask);
      low.delete();
      high.delete();
      part.delete();
    };

    if (hLow < 0) {
      addRange(0, hHigh);
      addRange(180 + hLow, 179);
    } else if (hHigh > 179) {
      addRange(hLow, 179);
      addRange(0, hHigh - 180);
    } else {
      addRange(hLow, hHigh);
    }
    return mask;
  }

  // ---- Die + pip detection ----------------------------------------------------

  function contourAt(cv, mask, rect) {
    // Crops the raw mask to `rect`; returns { contours, hierarchy } to clean up.
    const roi = mask.roi(rect);
    const inverted = new cv.Mat();
    cv.bitwise_not(roi, inverted);
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(inverted, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    roi.delete();
    inverted.delete();
    return { contours, hierarchy };
  }

  function countPips(cv, mask, dieRect, outerContour) {
    const { contours } = contourAt(cv, mask, dieRect);
    const dieArea = dieRect.width * dieRect.height;
    let pips = 0;

    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      const area = cv.contourArea(c);
      const relative = area / dieArea;
      // A pip is a small-ish, fairly round blob relative to the die face.
      if (relative > 0.012 && relative < 0.16) {
        const perimeter = cv.arcLength(c, true);
        const circularity = perimeter > 0 ? (4 * Math.PI * area) / (perimeter * perimeter) : 0;
        if (circularity > 0.45) {
          // Confirm the blob's centroid actually sits inside the die's
          // outer contour (guards against counting background corners of
          // the bounding rect as pips).
          const m = cv.moments(c);
          if (m.m00 > 0) {
            const cx = m.m10 / m.m00 + dieRect.x;
            const cy = m.m01 / m.m00 + dieRect.y;
            const inside = cv.pointPolygonTest(outerContour, new cv.Point(cx, cy), false);
            if (inside >= 0) pips++;
          }
        }
      }
      c.delete();
    }
    contours.delete();
    return pips;
  }

  function detectDiceForColor(cv, hsvMat, profile, frameArea, closeKernel) {
    const rawMask = maskForProfile(cv, hsvMat, profile);
    const filled = new cv.Mat();
    cv.morphologyEx(rawMask, filled, cv.MORPH_CLOSE, closeKernel, new cv.Point(-1, -1), 2);

    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(filled, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const results = [];
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      const area = cv.contourArea(c);
      const relativeArea = area / frameArea;

      if (relativeArea > 0.003 && relativeArea < 0.12) {
        const rect = cv.boundingRect(c);
        const aspect = rect.width / rect.height;
        const hull = new cv.Mat();
        cv.convexHull(c, hull);
        const hullArea = cv.contourArea(hull);
        const solidity = hullArea > 0 ? area / hullArea : 0;
        hull.delete();

        if (aspect > 0.55 && aspect < 1.8 && solidity > 0.75) {
          const pips = countPips(cv, rawMask, rect, c);
          const value = Math.min(6, Math.max(1, pips));
          results.push({
            color: profile.name,
            value,
            rawPipCount: pips,
            confident: pips >= 1 && pips <= 6,
            bbox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          });
        }
      }
      c.delete();
    }

    contours.delete();
    hierarchy.delete();
    rawMask.delete();
    filled.delete();
    return results;
  }

  /**
   * Analyze a captured frame (an HTMLCanvasElement already drawn with the
   * photo) against a list of calibrated color profiles.
   * Returns [{ color, value, confident, bbox }] with bbox in pixel
   * coordinates of the canvas.
   */
  function analyzeFrame(cv, canvas, profiles) {
    const src = cv.imread(canvas);
    const hsv = new cv.Mat();
    cv.cvtColor(src, hsv, cv.COLOR_RGBA2RGB);
    cv.cvtColor(hsv, hsv, cv.COLOR_RGB2HSV);

    const frameArea = canvas.width * canvas.height;
    // Scale the morphology kernel with resolution so it behaves similarly
    // across different camera resolutions.
    const kernelSize = Math.max(3, Math.round(Math.sqrt(frameArea) * 0.01));
    const closeKernel = cv.getStructuringElement(
      cv.MORPH_ELLIPSE,
      new cv.Size(kernelSize, kernelSize)
    );

    let all = [];
    for (const profile of profiles) {
      const found = detectDiceForColor(cv, hsv, profile, frameArea, closeKernel);
      all = all.concat(found);
    }

    closeKernel.delete();
    hsv.delete();
    src.delete();
    return all;
  }

  global.DiceVision = { sampleColorProfile, analyzeFrame };
})(typeof window !== 'undefined' ? window : globalThis);
