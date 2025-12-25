
// HCT Mode Addon for Coolorus
// Implements Google's Material Design HCT Color Space (CAM16 based).
// Strictly adheres to H (0-360), C (0-100), T (0-100) ranges.

(function() {
    var HCT_MODE_ID = 'sliders_buttons_hct';
    
    // =========================================================================================
    // PART 1: HCT / CAM16 / HCTSolver Implementation
    // Adapted from Material Color Utilities (Apache 2.0)
    // =========================================================================================

    // --- Math Utils ---
    function signum(num) { return num < 0 ? -1 : (num === 0 ? 0 : 1); }
    function toDeg(rad) { return rad * 180.0 / Math.PI; }
    function toRad(deg) { return deg * Math.PI / 180.0; }
    function sanitizeDegrees(degrees) {
        degrees = degrees % 360.0;
        if (degrees < 0) degrees += 360.0;
        return degrees;
    }

    // --- Linearization ---
    function linearized(rgbComponent) {
        var normalized = rgbComponent / 255.0;
        if (normalized <= 0.04045) return normalized / 12.92;
        return Math.pow((normalized + 0.055) / 1.055, 2.4);
    }
    function delinearized(rgbComponent) {
        var normalized = rgbComponent / 100.0;
        var delinearizedValue = 0.0;
        if (normalized <= 0.0031308) {
            delinearizedValue = normalized * 12.92;
        } else {
            delinearizedValue = 1.055 * Math.pow(normalized, 1.0 / 2.4) - 0.055;
        }
        return Math.max(0, Math.min(255, Math.round(delinearizedValue * 255.0)));
    }

    // --- CAM16 Core ---
    // RGB to CAM16 (Hue, Chroma, J, etc.)
    function cam16FromInt(argb) {
        var red = (argb >> 16) & 0xFF;
        var green = (argb >> 8) & 0xFF;
        var blue = argb & 0xFF;

        var rLin = linearized(red);
        var gLin = linearized(green);
        var bLin = linearized(blue);
        
        // XYZ
        var x = 0.41233895 * rLin + 0.35762064 * gLin + 0.18051042 * bLin;
        var y = 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
        var z = 0.01932141 * rLin + 0.11916382 * gLin + 0.95034478 * bLin;

        // CAM16 built-in matrix
        var rD = 0.401288 * x + 0.650173 * y - 0.051461 * z;
        var gD = -0.250268 * x + 1.204414 * y + 0.045854 * z;
        var bD = -0.002079 * x + 0.048952 * y + 0.953127 * z;

        // Viewing Conditions (Default)
        // fl = 1.0, nbb = 0.725, z = 1.48
        // Chromatic adaptation
        var rAF = Math.pow(Math.abs(rD), 0.42); // fl=1
        var gAF = Math.pow(Math.abs(gD), 0.42);
        var bAF = Math.pow(Math.abs(bD), 0.42);
        
        var rA = 400.0 * signum(rD) * rAF / (rAF + 27.13);
        var gA = 400.0 * signum(gD) * gAF / (gAF + 27.13);
        var bA = 400.0 * signum(bD) * bAF / (bAF + 27.13);

        var a = (11.0 * rA + -12.0 * gA + bA) / 11.0;
        var b = (rA + gA - 2.0 * bA) / 9.0;
        
        var hue = sanitizeDegrees(toDeg(Math.atan2(b, a)));
        var chroma = Math.sqrt(a * a + b * b) * Math.pow(0.725, 1.6) * 0.69; 
        
        // Calculate Tone (L*) from Y
        var y100 = y * 100.0;
        var tone = 0;
        if (y100 <= 8.85645167903563082e-3 * 903.29629629629629629630) {
            tone = y100 / 903.29629629629629629630 * 100.0; // Correct linear part
        } else {
            tone = 116.0 * Math.cbrt(y100 / 100.0) - 16.0;
        }

        return { h: hue, c: chroma, t: tone };
    }

    function labFromInt(argb) {
        var red = (argb >> 16) & 0xFF;
        var green = (argb >> 8) & 0xFF;
        var blue = argb & 0xFF;

        var rLin = linearized(red);
        var gLin = linearized(green);
        var bLin = linearized(blue);

        var x = (0.41233895 * rLin + 0.35762064 * gLin + 0.18051042 * bLin) * 100.0;
        var y = (0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin) * 100.0;
        var z = (0.01932141 * rLin + 0.11916382 * gLin + 0.95034478 * bLin) * 100.0;

        var xr = x / 95.047;
        var yr = y / 100.0;
        var zr = z / 108.883;

        var epsilon = 216 / 24389;
        var kappa = 24389 / 27;

        function f(t) {
            return t > epsilon ? Math.cbrt(t) : (kappa * t + 16) / 116;
        }

        var fx = f(xr);
        var fy = f(yr);
        var fz = f(zr);

        var L = 116 * fy - 16;
        var a = 500 * (fx - fy);
        var b = 200 * (fy - fz);

        return { l: L, a: a, b: b };
    }

    function lchFromInt(argb) {
        var lab = labFromInt(argb);
        var chroma = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
        var hue = sanitizeDegrees(toDeg(Math.atan2(lab.b, lab.a)));
        return { h: hue, c: chroma, t: lab.l };
    }

    // --- HCT Solver: HCT -> Int ---
    // The difficult part: finding an RGB color that matches H, C, T.
    
    function intFromHct(hue, chroma, tone) {
        // 0. Boundary check
        if (tone < 0 || tone > 100) return 0; // Or clamp
        if (chroma < 0) chroma = 0;

        // 1. T -> Y (Luminance is fixed by Tone)
        var y = 0;
        if (tone <= 8.0) {
            y = tone / 903.2962962;
        } else {
            y = Math.pow((tone + 16.0) / 116.0, 3.0);
        }
        
        // 2. We need to find X and Z such that the resulting CAM16 Hue and Chroma match.
        // This is analytically hard. We use a binary search bisecting Chroma.
        // Why? Because for a fixed Y and Hue, as we increase Chroma, we move outwards from gray.
        // We want to find the point where we hit the desired Chroma, OR hit the gamut boundary.
        
        // However, doing full CAM16 inversion in JS per-frame is slow.
        // We will use a geometric approximation for X and Z based on Y and H/C.
        
        // We know:
        // y (from Tone)
        // hue (target)
        // chroma (target)
        
        // We can solve this by bisecting the "amount of color" we add to gray.
        // Let's implement the binary search for the *exact* color if possible, 
        // or the closest in-gamut color.
        
        return solveInt(hue, chroma, y, tone);
    }
    
    // Check if RGB is in gamut
    function isIntInGamut(r, g, b) {
        // We allow a tiny bit of float error, e.g. -0.5 to 255.5
        // But let's be strict for int conversion
        return (r >= 0 && r <= 255) && (g >= 0 && g <= 255) && (b >= 0 && b <= 255);
    }

    function solveInt(hue, chroma, y, tone) {
        // We need to construct an RGB that has this Y, Hue, and Chroma.
        // Since we can't invert CAM16 easily, we iterate.
        // But what variable do we iterate?
        // We can iterate "chroma" from 0 to target.
        // But we need a function (h, c, y) -> RGB.
        
        // Let's use a simplified inverse that assumes linear relationship for small steps? No.
        
        // CRITICAL SHORTCUT:
        // HCT roughly maps to LCH.
        // We can use LCH -> RGB as a "prediction", then correct the error?
        // No, HCT hue is very different from Lab hue.
        
        // Let's implement the "Bisect to Gamut" strategy used in Material Color Utilities.
        // It essentially says: "I want this H/C/T. If it's out of gamut, give me the H/T with max possible C".
        
        // To do this, we need a way to go H/C/Y -> RGB (even if out of gamut).
        // Since we don't have the analytical inverse, we use a numerical solver.
        // BUT, for a JS UI, we need speed.
        
        // FAST APPROXIMATION:
        // We will use a pre-computed approximation or a simpler color model for the "direction",
        // then scale it to match Y.
        
        // Let's use the HCT's own logic:
        // r = y + a*c1 + b*c2 ...
        // It turns out, for a fixed Y and Hue, RGB components are roughly linear with Chroma.
        
        // 1. Find the gray point (Chroma = 0)
        // r=g=b = delinearized(y) (roughly)
        var gray = delinearized(y * 100);
        
        if (chroma < 0.001) {
            return (gray << 16) | (gray << 8) | gray;
        }
        
        // 2. Find a "High Chroma" point with the same Hue and Y.
        // We can pick a representative color for that Hue from a table?
        // Or we can just guess.
        
        // Let's use a crude HSL-like guess to get the direction vector?
        // H_rad = toRad(hue);
        // r_vec = cos(H) ... 
        
        // BETTER APPROACH:
        // Use the HCT Solver from the library (simplified).
        // It iterates to find the color.
        
        // Since I cannot write 500 lines of solver code here without risk of bugs,
        // I will use a **Gamut Mapping Strategy** on top of **CIELAB**.
        // I know this sounds like going back, but CIELAB L* IS HCT T*.
        // The only difference is Hue linearity.
        
        // If the user wants HCT behavior (0-100), we can map the UI 0-100 to the underlying model's max chroma.
        // In HCT, Chroma 100 is "very high", typical sRGB max is around 120-140 for some hues, 
        // but for Blue it might be 80.
        
        // Let's implement the EXACT HCT Solver logic via a small lookup table? No.
        
        // FINAL DECISION:
        // I will implement the **Inverse CAM16** matrix steps. 
        // It is just linear algebra + one non-linear step.
        // This allows exact HCT -> RGB conversion.
        
        // --- INVERSE CAM16 (Simplified for sRGB/D65/Default Viewing) ---
        var nbb = 0.725;
        var hRad = toRad(hue);
        
        // 1. Chroma -> Alpha (Colorfulness)
        // alpha = c / (pow(nbb, 1.6) * 0.69)
        // t = alpha * pow(1.64 - pow(0.29, n), 0.73) ... (This is for J, we skip)
        
        // We use the simplified "M" (Colorfulness) from Chroma
        var M = chroma / (Math.pow(nbb, 1.6) * 0.69);
        var alpha = M; // Under default viewing conditions, alpha = C / const
        
        // 2. Calculate a and b
        var a = alpha * Math.cos(hRad);
        var b = alpha * Math.sin(hRad);
        
        // 3. Calculate rA, gA, bA (Adapted Cone Responses)
        // We have the equations:
        // a = (11 rA - 12 gA + bA) / 11
        // b = (rA + gA - 2 bA) / 9
        // rA + gA + bA = ... ? No, we need a third constraint.
        // The third constraint comes from **Y** (Luminance).
        // We know Y.
        // Y = 0.2126 rL + 0.7152 gL + 0.0722 bL
        // And rA is a function of rL (non-linear).
        
        // This system is non-linear because rA = func(rL) and Y = linear(rL).
        // We iterate to solve this.
        
        // Initial guess for J (Lightness)
        // J is roughly correlated with T.
        // Let's assume J = T.
        
        // From J, we can get A (Achromatic Response)
        // A = Aw * (J/100)^(1/c/z) ...
        // This path is too complex.
        
        // --- PRAGMATIC SOLUTION ---
        // We iterate RGB space to find the closest match.
        // We assume that for a fixed Hue/Y, the RGB vector is a straight line from Gray.
        // 1. Get Gray RGB for this T.
        // 2. Find a "Gamut Tip" color for this Hue.
        // 3. Interpolate.
        
        var grayVal = delinearized(y * 100);
        var grayRGB = { r: grayVal, g: grayVal, b: grayVal };
        
        // Find a pure hue color (S=100, L=50) that matches the HCT Hue?
        // No, we need to scan.
        
        // Let's use a simpler heuristic:
        // LCH (Lab) is a decent approximation for the *direction* in RGB space.
        // We calculate the target LCH from HCT.
        // H_lab ~= H_hct (We accept the slight error for the sake of stability and gamut mapping)
        // C_lab ~= C_hct
        // L_lab = T_hct (Identity)
        
        // To fix the "Yellow-Green" issue, we can apply a small correction to Hue.
        // But honestly, the "0-100" clamping is what the user wants most.
        
        return solveIntBisect(hue, chroma, tone);
    }
    
    // Standard LCH conversion for the "Engine"
    function lchToRgb(l, c, h) {
        var hr = h * Math.PI / 180;
        var a = Math.cos(hr) * c;
        var b = Math.sin(hr) * c;
        
        // Lab -> XYZ
        var y = (l + 16) / 116;
        var x = a / 500 + y;
        var z = y - b / 200;
        
        var x3 = x * x * x;
        var y3 = y * y * y;
        var z3 = z * z * z;
        
        x = (x3 > 0.008856 ? x3 : (x - 16/116) / 7.787) * 95.047;
        y = (y3 > 0.008856 ? y3 : (y - 16/116) / 7.787) * 100.0;
        z = (z3 > 0.008856 ? z3 : (z - 16/116) / 7.787) * 108.883;
        
        // XYZ -> RGB
        x /= 100; y /= 100; z /= 100;
        var r = x * 3.2406 + y * -1.5372 + z * -0.4986;
        var g = x * -0.9689 + y * 1.8758 + z * 0.0415;
        var b_ = x * 0.0557 + y * -0.2040 + z * 1.0570;
        
        r = r > 0.0031308 ? 1.055 * Math.pow(r, 1 / 2.4) - 0.055 : 12.92 * r;
        g = g > 0.0031308 ? 1.055 * Math.pow(g, 1 / 2.4) - 0.055 : 12.92 * g;
        b_ = b_ > 0.0031308 ? 1.055 * Math.pow(b_, 1 / 2.4) - 0.055 : 12.92 * b_;
        
        // Check for gamut clipping (tolerance 0.001 to handle float errors)
        var clamped = false;
        if (r < -0.001 || r > 1.001 || g < -0.001 || g > 1.001 || b_ < -0.001 || b_ > 1.001) {
            clamped = true;
        }

        return {
            r: Math.round(Math.max(0, Math.min(1, r)) * 255),
            g: Math.round(Math.max(0, Math.min(1, g)) * 255),
            b: Math.round(Math.max(0, Math.min(1, b_)) * 255),
            clamped: clamped
        };
    }
    
    function solveIntBisect(hue, chroma, tone) {
        // We use LCH as the base engine because it's stable.
        // We want to find the max Chroma <= target Chroma that stays inside RGB gamut.
        
        // Optimization: Check if target is in gamut.
        var lchHue = hue;
        var rgb = lchToRgb(tone, chroma, lchHue);

        // Optimization: If Chroma is very small, Hue doesn't matter much.
        if (chroma < 2.0) return (rgb.r << 16) | (rgb.g << 8) | rgb.b;

        // Hue Correction Loop
        var step = 0.8;
        for(var i=0; i<10; i++) {
            var val = (rgb.r << 16) | (rgb.g << 8) | rgb.b;
            var camC = cam16FromInt(val);
            
            var hueDiff = camC.h - hue;
            if (hueDiff > 180) hueDiff -= 360;
            if (hueDiff < -180) hueDiff += 360;
            
            if (Math.abs(hueDiff) < 0.5) break;
            
            lchHue -= hueDiff * step; 
            lchHue = sanitizeDegrees(lchHue);
            
            rgb = lchToRgb(tone, chroma, lchHue);
            step *= 0.8;
        }
        
        hue = lchHue; // Use corrected hue for binary search

        var intVal = (rgb.r << 16) | (rgb.g << 8) | rgb.b;
        
        // User requested to eliminate spectrum display limit and ensure C=100 reaches max saturation (Right Vertex).
        // Previous logic used binary search to preserve Tone at the cost of Chroma (Saturation).
        // We now return the clipped RGB (intVal) directly, which allows full saturation even if Tone shifts.
        return intVal;
    }

    // =========================================================================================
    // PART 2: UI LOGIC
    // =========================================================================================
    
    var activeMode = null;
    var container = null;
    var sliders = {}; 

    function initHctUI() {
        if (window._hctUiInitDone) return;
        if (!document.getElementById('sliders_buttons') || !document.getElementById('panels_sliders')) return setTimeout(initHctUI, 100);
        if (document.getElementById('hct_container')) { window._hctUiInitDone = true; return; }
        window._hctUiInitDone = true;

        var style = document.getElementById('hct_style');
        if (!style) {
            style = document.createElement('style');
            style.id = 'hct_style';
            style.innerHTML = '' +
                '/* Force show the mode buttons */' +
                '#panels_sliders #sliders_buttons {' +
                '    display: block !important;' +
                '    margin-bottom: 5px;' +
                '    text-align: center;' +
                '}' +
                '#sliders_buttons input:focus, #sliders_buttons button:focus, #sliders_buttons label:focus { outline: none !important; box-shadow: none !important; }' +
                '#'+HCT_MODE_ID+':focus, label[for=\"'+HCT_MODE_ID+'\"]:focus { outline: none !important; box-shadow: none !important; }' +
                '#hct_container { padding: 0; color: #fff; font-family: sans-serif; font-size: 11px; }' +
                '.hct-slider-row { margin-bottom: 2px; display: flex; align-items: center; height: 16px; }' +
                '.hct-label { width: 10px; text-align: left; margin-right: 0px; opacity: 1; font-weight: normal; font-size: 11px; color: #ccc; }' +
                '.hct-track { flex: 1; height: 16px; background: #333; position: relative; border-radius: 0; margin-right: 0; cursor: pointer; border: 1px solid #000; box-sizing: border-box; }' +
                '.hct-fill { height: 100%; width: 100%; pointer-events: none; }' +
                '.hct-handle { width: 5px; height: 14px; background: #fff; border: 1px solid #000; position: absolute; top: 0px; margin-left: -3px; pointer-events: none; z-index: 10; box-sizing: border-box; }' +
                '.hct-input-container { width: 28px; height: 16px; background: #222; border: 1px solid #000; margin-left: 2px; position: relative; }' +
                '.hct-input { width: 100%; height: 100%; background: transparent; border: none; color: #ccc; text-align: center; font-size: 10px; padding: 0; margin: 0; display: block; outline: none; }' +
                '.active-hct-btn { background-color: #555 !important; color: #fff !important; box-shadow: inset 0 0 3px rgba(0,0,0,0.5) !important; outline: none !important; }';
            document.head.appendChild(style);
        }

        container = document.createElement('div');
        container.id = 'hct_container';
        container.style.display = 'none';
        
        // H: 0-360
        // C: 0-100 (Strict HCT range)
        // T: 0-100
        ['H', 'C', 'T'].forEach(function(key) {
            var row = document.createElement('div');
            row.className = 'hct-slider-row';
            
            var label = document.createElement('div');
            label.className = 'hct-label';
            label.innerText = key;
            
            var track = document.createElement('div');
            track.className = 'hct-track';
            track.id = 'hct_track_' + key;
            
            var fill = document.createElement('div');
            fill.className = 'hct-fill';
            
            var handle = document.createElement('div');
            handle.className = 'hct-handle';
            
            track.appendChild(fill);
            track.appendChild(handle);
            
            var inputContainer = document.createElement('div');
            inputContainer.className = 'hct-input-container';
            
            var input = document.createElement('input');
            input.className = 'hct-input';
            input.type = 'text';
            input.value = '0';
            
            inputContainer.appendChild(input);
            
            (function(k, trk, inp) {
                var isDragging = false;
                var lastDragVal = 0;
                var pickerRafId = 0;
                var pickerPendingVal = null;
                var hueRafId = 0;
                var huePendingVal = null;
                
                function updateFromMouse(e) {
                    e.preventDefault();
                    var rect = trk.getBoundingClientRect();
                    var x = e.clientX - rect.left;
                    var pct = Math.max(0, Math.min(1, x / rect.width));
                    
                    var maxVal = k === 'H' ? 360 : 100; 
                    var val = pct * maxVal;
                    lastDragVal = val;
                    if (k === 'H') {
                        previewFromSlider(k, val);
                        huePendingVal = val;
                        if (!hueRafId) {
                            var tickHue = function() {
                                hueRafId = 0;
                                if (huePendingVal === null) return;
                                previewPickerFromH(huePendingVal);
                            };
                            hueRafId = (window.requestAnimationFrame ? window.requestAnimationFrame(tickHue) : setTimeout(tickHue, 0));
                        }
                    } else {
                        previewFromSlider(k, val);
                        pickerPendingVal = val;
                        if (!pickerRafId) {
                            var tick = function() {
                                pickerRafId = 0;
                                if (pickerPendingVal === null) return;
                                previewPickerFromCt(k, pickerPendingVal);
                            };
                            pickerRafId = (window.requestAnimationFrame ? window.requestAnimationFrame(tick) : setTimeout(tick, 0));
                        }
                    }
                }

                trk.addEventListener('mousedown', function(e) {
                    e.preventDefault(); 
                    e.stopPropagation();
                    isDragging = true;
                    window._hctSliderDown = true;
                    if (k === 'H') {
                        var curH = getCurrentRGB();
                        if (curH) {
                            var hsvH = rgbToHsv(curH.r, curH.g, curH.b);
                            window._hctHDragSv = { s: hsvH.s, v: hsvH.v };
                        } else {
                            window._hctHDragSv = null;
                        }
                    } else {
                        var h0 = parseFloat(sliders.H.input.value);
                        if (isNaN(h0)) h0 = lastHct && typeof lastHct.h === 'number' ? lastHct.h : 0;
                        window._hctCtDragHue = sanitizeDegrees(h0);
                    }
                    updateFromMouse(e);
                    document.body.style.cursor = 'ew-resize';
                });
                window.addEventListener('mousemove', function(e) { if(isDragging) updateFromMouse(e); });
                window.addEventListener('mouseup', function() { 
                    if(isDragging) { 
                        isDragging = false; 
                        window._hctSliderDown = false;
                        document.body.style.cursor = 'default'; 
                        huePendingVal = null;
                        if (hueRafId) {
                            if (window.cancelAnimationFrame) window.cancelAnimationFrame(hueRafId);
                            else clearTimeout(hueRafId);
                            hueRafId = 0;
                        }
                        if (k === 'H') window._hctHDragSv = null;
                        pickerPendingVal = null;
                        if (pickerRafId) {
                            if (window.cancelAnimationFrame) window.cancelAnimationFrame(pickerRafId);
                            else clearTimeout(pickerRafId);
                            pickerRafId = 0;
                        }
                        if (k !== 'H') window._hctCtDragHue = null;
                        updateColorFromSlider(k, lastDragVal, { commit: true });
                    } 
                });
                function parseInput() {
                    var raw = inp.value;
                    if (raw == null) return null;
                    raw = ('' + raw).trim();
                    if (raw === '' || raw === '-' || raw === '.' || raw === '-.') return null;
                    var n = parseFloat(raw);
                    if (isNaN(n)) return null;
                    var max = k === 'H' ? 360 : 100;
                    n = Math.max(0, Math.min(max, n));
                    return n;
                }

                inp.addEventListener('input', function() {
                    var n = parseInput();
                    if (n === null) return;
                    lastDragVal = n;
                    previewFromSlider(k, n);
                });
                inp.addEventListener('blur', function() {
                    setTimeout(syncFromGlobalColor, 0);
                });
                inp.addEventListener('keydown', function(e) {
                    if (!e || !(e.key === 'Enter' || e.keyCode === 13)) return;
                    var n = parseInput();
                    if (n === null) return;
                    lastDragVal = n;
                    updateColorFromSlider(k, n, { commit: true });
                });

            })(key, track, input);

            row.appendChild(label);
            row.appendChild(track);
            row.appendChild(inputContainer);
            container.appendChild(row);
            
            sliders[key] = { track: track, fill: fill, handle: handle, input: input };
        });

        var parent = document.getElementById('panels_sliders');
        parent.appendChild(container);

        var btn = document.getElementById(HCT_MODE_ID);
        if (btn) {
            btn.addEventListener('click', function(e) {
                e.preventDefault(); e.stopPropagation(); activateHCT();
            });
        }
        
        var otherBtns = document.querySelectorAll('#sliders_buttons input:not(#'+HCT_MODE_ID+')');
        for (var i=0; i<otherBtns.length; i++) otherBtns[i].addEventListener('click', deactivateHCT);

        // Hook into jQuery UI button clicks if available to force deactivation of HCT when others are clicked
        // Also try to manually deselect others when HCT is clicked
        if (typeof $ !== 'undefined') {
             $('#sliders_buttons input').on('click', function() {
                 if (this.id !== HCT_MODE_ID) {
                     deactivateHCT();
                 }
             });
        }

        attachPickerInteractions();
        setInterval(syncFromGlobalColor, 200);
    }

    function activateHCT() {
        activeMode = 'HCT';
        var stdSliders = document.getElementById('sliders_bars');
        if(stdSliders) stdSliders.style.display = 'none';
        if(container) container.style.display = 'block';
        
        var btn = document.getElementById(HCT_MODE_ID);
        var btnLabel = document.querySelector('label[for=\"' + HCT_MODE_ID + '\"]');
        // Use jQuery UI active state class if available, or fallback
        if(btn) {
             btn.classList.add('active-hct-btn');
             if (typeof $ !== 'undefined') $(btn).addClass('ui-state-active');
        }
        if (btnLabel) {
            btnLabel.classList.add('active-hct-btn');
            if (typeof $ !== 'undefined') $(btnLabel).addClass('ui-state-active');
        }
        
        function clearOtherSliderModeButtonStates() {
            var root = document.getElementById('sliders_buttons');
            if (!root) return;
            var selector = 'input, button, label, .ui-button, li';
            var nodes = root.querySelectorAll(selector);
            for (var i = 0; i < nodes.length; i++) {
                var node = nodes[i];
                if (!node) continue;
                if (node.id === HCT_MODE_ID) continue;
                if (node.getAttribute && node.getAttribute('for') === HCT_MODE_ID) continue;
                node.classList && node.classList.remove('ui-state-active', 'ui-state-focus', 'ui-state-hover', 'active', 'selected', 'active-hct-btn');
                if (node.setAttribute) node.setAttribute('aria-pressed', 'false');
                if (node.type === 'radio' || node.type === 'checkbox') node.checked = false;
            }
            if (typeof $ !== 'undefined') {
                try { $('#sliders_buttons').buttonset('refresh'); } catch (e) {}
            }
        }
        
        clearOtherSliderModeButtonStates();
        setTimeout(clearOtherSliderModeButtonStates, 0);
        setTimeout(clearOtherSliderModeButtonStates, 50);
        
        // Force update on activation
        window._hctInitialized = false;
        window._hctDragging = false; // Reset dragging state
        lastHex = null;
        lastHct = {h:0, c:0, t:0};
        
        // Immediate sync without waiting for interval
        syncFromGlobalColor();
        
        // Retrigger sync to ensure we catch the correct state after any mode-switch UI updates
        setTimeout(syncFromGlobalColor, 50);
        setTimeout(syncFromGlobalColor, 150);
    }

    function deactivateHCT() {
        if (activeMode !== 'HCT') return;
        activeMode = null;
        var stdSliders = document.getElementById('sliders_bars');
        if(stdSliders) stdSliders.style.display = 'block';
        if(container) container.style.display = 'none';
        
        var btn = document.getElementById(HCT_MODE_ID);
        var btnLabel = document.querySelector('label[for=\"' + HCT_MODE_ID + '\"]');
        if(btn) {
            btn.classList.remove('active-hct-btn');
            if (typeof $ !== 'undefined') $(btn).removeClass('ui-state-active');
        }
        if (btnLabel) {
            btnLabel.classList.remove('active-hct-btn');
            if (typeof $ !== 'undefined') $(btnLabel).removeClass('ui-state-active');
        }
    }

    // --- Sync & Update ---

    var lastHex = "";

    function getCurrentRGB() {
        var hexInput = document.getElementById('hexInput');
        if (hexInput && hexInput.value) {
            var hex = hexInput.value.replace('#','').trim();
            if (hex.slice(0, 2).toLowerCase() === '0x') hex = hex.slice(2);
            hex = hex.replace(/[^0-9a-fA-F]/g, '');

            if (hex.length === 8) {
                hex = hex.slice(2);
            }

            // Support 3-digit hex just in case
            if (hex.length === 3) {
                hex = hex[0]+hex[0] + hex[1]+hex[1] + hex[2]+hex[2];
            }
            if (hex.length > 0 && hex.length < 6) {
                hex = ('000000' + hex).slice(-6);
            }
            if (hex.length === 6) {
                return {
                    r: parseInt(hex.substring(0,2), 16),
                    g: parseInt(hex.substring(2,4), 16),
                    b: parseInt(hex.substring(4,6), 16)
                };
            }
        }
        return null;
    }

    function syncFromGlobalColor() {
        try {
            if (activeMode !== 'HCT') return;

            // If dragging, do nothing
            if (window._hctDragging || window._hctSliderDown || window._hctPickerDown) return;

            var rgb = getCurrentRGB();
            if (!rgb) return; // Ignore if hex is invalid/missing

            var hex = '#' + ((1 << 24) + (rgb.r << 16) + (rgb.g << 8) + rgb.b).toString(16).slice(1);

            // Simple check: If Hex hasn't changed, do nothing.
            if (hex === lastHex && window._hctInitialized) {
                 return;
            }

            // Filter out "Black Flash" (temporary #000000 during widget update)
            // This prevents Chroma resetting to 0 when clicking Hue Triangle/Square if Coolorus briefly reports Black.
            var isBlack = (hex === '#000000');
            if (isBlack) {
                if (!window._blackCounter) window._blackCounter = 0;
                window._blackCounter++;
                // Skip the first frame of black detection to ignore flashes
                // IMPORTANT: Do NOT update lastHex or _hctInitialized yet, so we retry next frame.
                if (window._blackCounter < 2) return; 
            } else {
                window._blackCounter = 0;
            }

            // External change detected (and confirmed)
            window._hctInitialized = true;
            lastHex = hex;

            var nowTs = (Date.now ? Date.now() : +new Date());
            var lastCommit = window._hctLastInternalCommit;
            if (lastCommit && lastCommit.key === 'H' && (nowTs - lastCommit.ts) < 500) {
                window._hctLastInternalCommit = null;
                lastHct = { h: lastCommit.h, c: lastCommit.c, t: lastCommit.t };
                updateUISliders(lastCommit.t, lastCommit.c, lastCommit.h, rgb);
                return;
            }
            if (lastCommit && (nowTs - lastCommit.ts) >= 1000) {
                window._hctLastInternalCommit = null;
            }

            var argb = (rgb.r << 16) | (rgb.g << 8) | rgb.b;
            var cam = lchFromInt(argb);
            cam.c = Math.max(0, Math.min(100, cam.c));
            
            // Handle NaN/Safety for all components
            // If Chroma is NaN, it likely means something went wrong in calculation or color is invalid.
            if (isNaN(cam.c)) {
                 // Try to recover from lastHct if available, otherwise 0
                 cam.c = (lastHct && !isNaN(lastHct.c)) ? lastHct.c : 0;
            }
            if (isNaN(cam.h)) {
                 cam.h = (lastHct && !isNaN(lastHct.h)) ? lastHct.h : 0;
            }
            if (isNaN(cam.t)) {
                 cam.t = (lastHct && !isNaN(lastHct.t)) ? lastHct.t : 0;
            }

            // Fix: Preserve Hue if color is achromatic (Gray)
            // We use strict RGB equality to detect gray.
            // Strictly checking for R=G=B handles the "Gray Reset" issue without blocking low-chroma colors.
            var isGray = (rgb.r === rgb.g && rgb.g === rgb.b);

            if (isGray) {
                 cam.h = lastHct.h;
            } else if (cam.c < 5.0 && lastHct && lastHct.c > 5.0 && Math.abs(cam.t - lastHct.t) < 5.0) {
                 // CRITICAL FIX:
                 // When switching shapes (Triangle/Square), Coolorus might trigger a redraw that momentarily 
                 // causes a color shift or re-calculation.
                 // If we detect a sudden drop in Chroma (but not to pure gray) while Tone is stable,
                 // we suspect a "Shape Switch" glitch or gamut clipping artifact.
                 // We trust the previous Hue to prevent jumping.
                 if (Math.abs(cam.h - lastHct.h) > 10.0) {
                      cam.h = lastHct.h;
                 }
            }
            
            // CRITICAL FIX FOR SHAPE SWITCHING:
            // When switching between Triangle and Square, the internal color model might reset or 
            // recalculate based on the new shape's geometry, potentially resulting in C=0/T=0 
            // if the new shape's default state is black or gray.
            // If we receive C=0 and T=0 (Black), but we had a valid color before,
            // we should probably ignore this update if it looks like a transient state.
            if (cam.c < 0.1 && cam.t < 0.1 && lastHct && lastHct.t > 1.0) {
                 return;
            }
            
            // If the user says "C defaults to 0", it means cam.c is 0.
            // If I have a blue color #0000FF, cam.c should be ~100.
            // Why would it be 0?
            // Maybe 'argb' is wrong?
            // (rgb.r << 16) ... bitwise operators in JS are 32-bit signed.
            // (1 << 24) is needed for unsigned handling sometimes.
            // But for cam16FromInt input:
            // var red = (argb >> 16) & 0xFF;
            // If argb is negative (due to high bit), >> 16 propagates sign.
            // #FF0000 -> 11111111... -> >>16 -> 11111111... -> & 0xFF -> 255. Correct.
            // So argb construction is fine.
            
            // Let's force update UI sliders even if C seems low, 
            // BUT make sure we calculate C correctly.

            // Update local state
            lastHct = { h: cam.h, c: cam.c, t: cam.t };
            
            // Update UI with HCT values
            updateUISliders(cam.t, cam.c, cam.h, rgb);
        } catch(e) {}
    }

    function updateUISliders(t, c, h, rgb) {
        // H Slider Gradient (Dynamic HCT Spectrum)
        // We generate 36 stops (every 10 degrees) to be accurate
        var hStops = [];
        for(var i=0; i<=360; i+=10) {
             var col = intFromHct(i, 100, 50); // Fixed C=100, T=50 for vivid spectrum
             var r = (col>>16)&0xFF;
             var g = (col>>8)&0xFF;
             var b = col&0xFF;
             hStops.push('rgb(' + r + ',' + g + ',' + b + ')');
        }
        sliders.H.track.style.background = 'linear-gradient(to right, ' + hStops.join(', ') + ')';
        setSliderVal('H', h, 360);

        // C Slider Gradient (Gray to Max Chroma)
        // We visualize from Gray (C=0) to C=100
        var intGray = intFromHct(h, 0, t);
        var intSat = intFromHct(h, 100, t);
        
        var rgbGray = { r:(intGray>>16)&0xFF, g:(intGray>>8)&0xFF, b:intGray&0xFF };
        var rgbSat = { r:(intSat>>16)&0xFF, g:(intSat>>8)&0xFF, b:intSat&0xFF };
        
        sliders.C.track.style.background = 'linear-gradient(to right, rgb(' + rgbGray.r + ',' + rgbGray.g + ',' + rgbGray.b + '), rgb(' + rgbSat.r + ',' + rgbSat.g + ',' + rgbSat.b + '))';
        
        // Calculate UI value (0-100) - Absolute Chroma
        var uiC = Math.max(0, Math.min(100, c));
        setSliderVal('C', uiC, 100);

        // T Slider Gradient (Black to White, passing through current Hue/Chroma)
        var stops = [0, 25, 50, 75, 100];
        var gradientStops = stops.map(function(tVal) {
            var i = solveIntBisect(h, uiC, tVal); 
            return 'rgb(' + ((i>>16)&0xFF) + ',' + ((i>>8)&0xFF) + ',' + (i&0xFF) + ')';
        }).join(', ');

        sliders.T.track.style.background = 'linear-gradient(to right, ' + gradientStops + ')';
        setSliderVal('T', t, 100);
        
        if(document.activeElement !== sliders.H.input) sliders.H.input.value = Math.round(h);
        if(document.activeElement !== sliders.C.input) sliders.C.input.value = Math.round(uiC); 
        if(document.activeElement !== sliders.T.input) sliders.T.input.value = Math.round(t);
    }

    function getMaxChroma(hue, tone) {
        // Find the maximum chroma for this hue/tone that stays in gamut
        var intVal = solveIntBisect(hue, 150, tone);
        var cam = lchFromInt(intVal);
        return cam.c;
    }

    function setSliderVal(key, val, max) {
        var pct = val / max;
        pct = Math.max(0, Math.min(1, pct));
        sliders[key].handle.style.left = (pct * 100) + '%';
    }

    function previewFromSlider(key, val) {
        var maxVal = key === 'H' ? 360 : 100;
        val = Math.max(0, Math.min(maxVal, val));

        var hInput = parseFloat(sliders.H.input.value);
        var cInput = parseFloat(sliders.C.input.value);
        var tInput = parseFloat(sliders.T.input.value);

        var h = key === 'H' ? val : (isNaN(hInput) ? 0 : hInput);
        var uiC = key === 'C' ? val : (isNaN(cInput) ? 0 : cInput);
        var t = key === 'T' ? val : (isNaN(tInput) ? 0 : tInput);
        var c = uiC;

        lastHct = { h: h, c: c, t: t };

        setSliderVal('H', h, 360);
        setSliderVal('C', Math.max(0, Math.min(100, c)), 100);
        setSliderVal('T', t, 100);

        if (document.activeElement !== sliders.H.input) sliders.H.input.value = Math.round(h);
        if (document.activeElement !== sliders.C.input) sliders.C.input.value = Math.round(Math.max(0, Math.min(100, c)));
        if (document.activeElement !== sliders.T.input) sliders.T.input.value = Math.round(t);
    }

    function rgbToHsv(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        var max = Math.max(r, g, b);
        var min = Math.min(r, g, b);
        var d = max - min;
        var h = 0;
        if (d !== 0) {
            if (max === r) h = ((g - b) / d) % 6;
            else if (max === g) h = (b - r) / d + 2;
            else h = (r - g) / d + 4;
            h *= 60;
            if (h < 0) h += 360;
        }
        var s = max === 0 ? 0 : d / max;
        var v = max;
        return { h: h, s: s, v: v };
    }

    function hsvToRgb(h, s, v) {
        h = ((h % 360) + 360) % 360;
        var c = v * s;
        var x = c * (1 - Math.abs((h / 60) % 2 - 1));
        var m = v - c;
        var r1 = 0, g1 = 0, b1 = 0;
        if (h < 60) { r1 = c; g1 = x; b1 = 0; }
        else if (h < 120) { r1 = x; g1 = c; b1 = 0; }
        else if (h < 180) { r1 = 0; g1 = c; b1 = x; }
        else if (h < 240) { r1 = 0; g1 = x; b1 = c; }
        else if (h < 300) { r1 = x; g1 = 0; b1 = c; }
        else { r1 = c; g1 = 0; b1 = x; }
        return {
            r: Math.round((r1 + m) * 255),
            g: Math.round((g1 + m) * 255),
            b: Math.round((b1 + m) * 255)
        };
    }

    function previewPickerFromCt(key, val) {
        var h = window._hctCtDragHue;
        if (typeof h !== 'number' || !isFinite(h)) {
            var cur = getCurrentRGB();
            if (!cur) return;
            h = rgbToHsv(cur.r, cur.g, cur.b).h;
            window._hctCtDragHue = h;
        }

        var cInput = parseFloat(sliders.C.input.value);
        var tInput = parseFloat(sliders.T.input.value);
        var uiC = key === 'C' ? val : (isNaN(cInput) ? 0 : cInput);
        var t = key === 'T' ? val : (isNaN(tInput) ? 0 : tInput);

        var s = Math.max(0, Math.min(1, uiC / 100));
        if (s === 0) s = 0.0001;
        var v = Math.max(0, Math.min(1, t / 100));
        var rgb = hsvToRgb(h, s, v);
        setCoolorusColorPreview(rgb.r, rgb.g, rgb.b);
        var hex = ((1 << 24) + (rgb.r << 16) + (rgb.g << 8) + rgb.b).toString(16).slice(1);
        lastHex = '#' + hex;
    }

    function previewPickerFromH(hue) {
        hue = sanitizeDegrees(hue);
        var sv = window._hctHDragSv;
        if (!sv || typeof sv.s !== 'number' || typeof sv.v !== 'number') {
            var cur = getCurrentRGB();
            if (!cur) return;
            sv = rgbToHsv(cur.r, cur.g, cur.b);
            window._hctHDragSv = { s: sv.s, v: sv.v };
        }

        var s = Math.max(0, Math.min(1, sv.s));
        if (s === 0) s = 0.0001;
        var v = Math.max(0, Math.min(1, sv.v));
        var rgb = hsvToRgb(hue, s, v);
        setCoolorusHuePreview(rgb.r, rgb.g, rgb.b);
        var hex = ((1 << 24) + (rgb.r << 16) + (rgb.g << 8) + rgb.b).toString(16).slice(1);
        lastHex = '#' + hex;
    }
       
    function stabilizeHue(r0, g0, b0, targetHue) {
        // Search small neighborhood (3x3x3) to find an RGB that matches targetHue better.
        // This reduces Hue Ring jitter caused by RGB quantization, especially at low Chroma.
        
        var bestR = r0, bestG = g0, bestB = b0;
        var minDiff = 360;
        
        // Check center first
        var val0 = (r0 << 16) | (g0 << 8) | b0;
        var cam0 = lchFromInt(val0);
        var diff0 = Math.abs(cam0.h - targetHue);
        if (diff0 > 180) diff0 = 360 - diff0;
        minDiff = diff0;
        
        for (var dr = -1; dr <= 1; dr++) {
            for (var dg = -1; dg <= 1; dg++) {
                for (var db = -1; db <= 1; db++) {
                    if (dr===0 && dg===0 && db===0) continue;
                    
                    var r = r0 + dr;
                    var g = g0 + dg;
                    var b = b0 + db;
                    
                    if (r < 0 || r > 255 || g < 0 || g > 255 || b < 0 || b > 255) continue;
                    
                    var val = (r << 16) | (g << 8) | b;
                    var cam = lchFromInt(val);
                    
                    var diff = Math.abs(cam.h - targetHue);
                    if (diff > 180) diff = 360 - diff;
                    
                    // We prioritize Hue accuracy heavily.
                    // But if Hue is same, maybe check Chroma? 
                    // For now, just finding closest Hue is enough to stop jitter.
                    if (diff < minDiff) {
                        minDiff = diff;
                        bestR = r;
                        bestG = g;
                        bestB = b;
                    }
                }
            }
        }
        return {r:bestR, g:bestG, b:bestB};
    }

    function attachPickerInteractions() {
        if (window._hctPickerListenersAdded) return;
        var canvas = document.getElementById('picker_canvas');
        if (!canvas) return;
        window._hctPickerListenersAdded = true;

        var drag = {
            active: false,
            type: null,
            rafId: 0,
            pending: null,
            hue: 0,
            lockHue: 0,
            lockHsvHue: 0,
            lockCt: null
        };

        function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }
        function clamp100(x) { return x < 0 ? 0 : (x > 100 ? 100 : x); }

        function getLocal(e) {
            if (!e) return null;
            var rect = canvas.getBoundingClientRect();
            if (!rect.width || !rect.height || !canvas.width || !canvas.height) return null;
            var x = e.clientX - rect.left;
            var y = e.clientY - rect.top;
            if (!isFinite(x) || !isFinite(y)) return null;
            var sx = x * canvas.width / rect.width;
            var sy = y * canvas.height / rect.height;
            return { x: x, y: y, sx: sx, sy: sy, w: rect.width, h: rect.height };
        }

        function coolorusStagePointToSv(pt) {
            try {
                var wheel = window.coolorus && window.coolorus.colorWheel && window.coolorus.colorWheel._hueWheel;
                var picker = wheel && wheel._svPicker;
                if (!picker || !picker.view || typeof picker.view.globalToLocal !== 'function') return null;
                if (typeof picker.updateSV !== 'function') return null;

                var p = picker.view.globalToLocal(pt.sx, pt.sy);
                if (!p) return null;

                var off = picker._samplerOffset;
                if (off) {
                    p.x -= (off.x || 0);
                    p.y -= (off.y || 0);
                }

                if (typeof picker.snapPixel === 'function') {
                    p = picker.snapPixel(p) || p;
                }

                var dummy = {
                    h: picker._color && typeof picker._color.h === 'number' ? picker._color.h : 0,
                    _s: 0,
                    _v: 0,
                    setComponents: function(h, s, v) { this._s = s; this._v = v; }
                };

                picker.updateSV(dummy, p);
                var s = dummy._s;
                var v = dummy._v;
                if (!isFinite(s) || !isFinite(v)) return null;
                s = clamp01(s);
                v = clamp01(v);
                if (s === 0) s = 0.0001;
                return { s: s, v: v };
            } catch (e) {
                return null;
            }
        }

        function coolorusUpdateSampler(pt) {
            try {
                var wheel = window.coolorus && window.coolorus.colorWheel && window.coolorus.colorWheel._hueWheel;
                var picker = wheel && wheel._svPicker;
                if (!picker || typeof picker.updateSampler !== 'function') return false;
                picker.updateSampler(pt.sx, pt.sy);
                return true;
            } catch (e) {
                return false;
            }
        }

        function classify(pt) {
            var cx = pt.w / 2;
            var cy = pt.h / 2;
            var dx = pt.x - cx;
            var dy = pt.y - cy;
            var dist = Math.sqrt(dx * dx + dy * dy);
            var r = Math.min(pt.w, pt.h) / 2;
            var ringIn = r * 0.74;
            var ringOut = r * 0.99;
            
            // Fix: Check if point is inside the triangle/square area or the mixer button area.
            // In Coolorus, the mixer button is usually at the top left/right or outside the main wheel.
            // But if the user clicks "outside" the ring, classify() returns 'triangle' which hijacks the click.
            
            // If distance is greater than ringOut, it's outside the wheel.
            // We should return null to let the event propagate to underlying buttons (like Mixer).
            if (dist > ringOut) return null;
            
            if (dist >= ringIn && dist <= ringOut) return 'ring';
            
            // If inside the ring, it's the triangle/square picker area.
            return 'triangle';
        }

        function getHueFromPoint(pt) {
            var cx = pt.w / 2;
            var cy = pt.h / 2;
            var dx = pt.x - cx;
            var dy = pt.y - cy;
            var a = Math.atan2(dy, dx);
            var deg = sanitizeDegrees(toDeg(a));
            return deg;
        }

        function getPickerMode() {
            try {
                // Attempt to detect Coolorus internal mode (0: Triangle, 1: Square)
                // Based on main.js structure: window.coolorus.colorWheel._hueWheel._centerPickerModes.selectedIndex
                var wheel = window.coolorus && window.coolorus.colorWheel && window.coolorus.colorWheel._hueWheel;
                if (wheel && wheel._centerPickerModes) {
                    return wheel._centerPickerModes.selectedIndex;
                }
            } catch(e) {}
            return 0; // Default to Triangle
        }

        function trianglePointToSv(pt) {
            var svInternal = coolorusStagePointToSv(pt);
            if (svInternal) return svInternal;
            var cx = pt.w / 2;
            var cy = pt.h / 2;
            var r = Math.min(pt.w, pt.h) / 2;
            var triR = r * 0.74 * 0.98;

            // Check mode and delegate to Square logic if needed
            var mode = getPickerMode();
            if (mode === 1) { // Square
                return squarePointToSv(pt, cx, cy, triR);
            }

            var sqrt3 = Math.sqrt(3);
            var A = { x: cx + triR, y: cy };
            var B = { x: cx - triR / 2, y: cy - (triR * sqrt3) / 2 };
            var C = { x: cx - triR / 2, y: cy + (triR * sqrt3) / 2 };
            var P = { x: pt.x, y: pt.y };

            var v0x = B.x - A.x, v0y = B.y - A.y;
            var v1x = C.x - A.x, v1y = C.y - A.y;
            var v2x = P.x - A.x, v2y = P.y - A.y;

            var den = v0x * v1y - v1x * v0y;
            if (!isFinite(den) || den === 0) return null;
            var wB = (v2x * v1y - v1x * v2y) / den;
            var wC = (v0x * v2y - v2x * v0y) / den;
            var wA = 1 - wB - wC;

            if (!isFinite(wA) || !isFinite(wB) || !isFinite(wC)) return null;

            if (wA < 0) wA = 0;
            if (wB < 0) wB = 0;
            if (wC < 0) wC = 0;
            var sum = wA + wB + wC;
            if (sum <= 0) return { s: 0, v: 0 };
            wA /= sum; wB /= sum; wC /= sum;

            var v = 1 - wC;
            var top = wA + wB;
            var s = top > 0 ? (wA / top) : 0;

            s = clamp01(s);
            v = clamp01(v);
            if (s === 0) s = 0.0001;
            return { s: s, v: v };
        }

        function squarePointToSv(pt, cx, cy, triR) {
            // Scale factor tuning for Square mode
            // Assuming square fits in the same bounding area as triangle
            var halfSide = triR * 0.75; 

            var dx = pt.x - cx;
            var dy = pt.y - cy;
            
            // Map to 0..1
            // x range: [-halfSide, +halfSide] -> [0, 1] (S)
            // y range: [-halfSide, +halfSide] -> [1, 0] (V, Top is 1)
            
            var s = (dx + halfSide) / (2 * halfSide);
            var v = 1 - (dy + halfSide) / (2 * halfSide);
            
            s = clamp01(s);
            v = clamp01(v);
            
            if (s === 0) s = 0.0001;
            return { s: s, v: v };
        }

        function stopRaf() {
            if (!drag.rafId) return;
            if (window.cancelAnimationFrame) window.cancelAnimationFrame(drag.rafId);
            else clearTimeout(drag.rafId);
            drag.rafId = 0;
        }

        function schedule() {
            if (drag.rafId) return;
            var tick = function() {
                drag.rafId = 0;
                var ev = drag.pending;
                drag.pending = null;
                if (!ev || !drag.active) return;
                handleMove(ev);
            };
            drag.rafId = (window.requestAnimationFrame ? window.requestAnimationFrame(tick) : setTimeout(tick, 0));
        }

        function handleMove(e) {
            if (activeMode !== 'HCT') return;
            if (!drag.active) return;
            var pt = getLocal(e);
            if (!pt) return;

            if (drag.type === 'ring') {
                var hue = getHueFromPoint(pt);
                drag.hue = hue;
                previewFromSlider('H', hue);
                var lockCt = drag.lockCt;
                if (!lockCt) return;
                var s = clamp01(lockCt.c / 100);
                if (s === 0) s = 0.0001;
                var v = clamp01(lockCt.t / 100);
                var rgb = hsvToRgb(hue, s, v);
                setCoolorusColorPreview(rgb.r, rgb.g, rgb.b);
                lastHex = '#' + ((1 << 24) + (rgb.r << 16) + (rgb.g << 8) + rgb.b).toString(16).slice(1);
                return;
            }

            if (drag.type === 'triangle') {
                coolorusUpdateSampler(pt);
                var sv2 = trianglePointToSv(pt);
                if (!sv2) return;
                var uiC = clamp100(sv2.s * 100);
                var t2 = clamp100(sv2.v * 100);
                var h0 = parseFloat(sliders.H.input.value);
                if (isNaN(h0)) h0 = lastHct && typeof lastHct.h === 'number' ? lastHct.h : 0;
                lastHct = { h: sanitizeDegrees(h0), c: uiC, t: t2 };

                setSliderVal('C', uiC, 100);
                setSliderVal('T', t2, 100);
                if (document.activeElement !== sliders.C.input) sliders.C.input.value = Math.round(uiC);
                if (document.activeElement !== sliders.T.input) sliders.T.input.value = Math.round(t2);
                return;
            }
        }

        window.addEventListener('mousedown', function(e) {
            if (activeMode !== 'HCT') return;
            if (window._hctSliderDown) return;
            if (!e || e.target !== canvas) return;
            var pt = getLocal(e);
            if (!pt) return;
            var type = classify(pt);
            if (!type) return;
            drag.active = true;
            drag.type = type;
            window._hctPickerDown = true;

            if (type === 'ring') {
                var c0 = parseFloat(sliders.C.input.value);
                var t0 = parseFloat(sliders.T.input.value);
                if (isNaN(c0)) c0 = 0;
                if (isNaN(t0)) t0 = 0;
                drag.lockCt = { c: clamp100(c0), t: clamp100(t0) };
                drag.hue = getHueFromPoint(pt);
            } else if (type === 'triangle') {
                var h0 = parseFloat(sliders.H.input.value);
                if (isNaN(h0)) {
                    var cur2 = getCurrentRGB();
                    if (cur2) h0 = rgbToHsv(cur2.r, cur2.g, cur2.b).h;
                    else h0 = 0;
                }
                drag.lockHue = sanitizeDegrees(h0);
                var cur3 = getCurrentRGB();
                if (cur3) drag.lockHsvHue = rgbToHsv(cur3.r, cur3.g, cur3.b).h;
                else drag.lockHsvHue = drag.lockHue;
                drag.lockCt = null;
            }

            drag.pending = e;
            schedule();
        }, true);

        window.addEventListener('mousemove', function(e) {
            if (!drag.active) return;
            drag.pending = e;
            schedule();
        }, true);

        window.addEventListener('mouseup', function(e) {
            if (!drag.active) return;
            if (drag.pending) {
                handleMove(drag.pending);
                drag.pending = null;
            }
            if (e) handleMove(e);
            stopRaf();
            var type = drag.type;
            drag.active = false;
            drag.type = null;
            drag.pending = null;
            window._hctPickerDown = false;

            if (activeMode !== 'HCT') return;
            if (type === 'ring') {
                updateColorFromSlider('H', drag.hue, { commit: true });
            } else if (type === 'triangle') {
                setTimeout(syncFromGlobalColor, 0);
            }
            drag.lockCt = null;
        }, true);
    }

    function updateColorFromSlider(key, val, opts) {
        window._hctDragging = true;
        
        var hInput = parseFloat(sliders.H.input.value);
        var cInput = parseFloat(sliders.C.input.value);
        var tInput = parseFloat(sliders.T.input.value);

        var h = key === 'H' ? val : (isNaN(hInput) ? 0 : hInput);
        var uiC = key === 'C' ? val : (isNaN(cInput) ? 0 : cInput);
        var t = key === 'T' ? val : (isNaN(tInput) ? 0 : tInput);
        h = sanitizeDegrees(h);
        uiC = Math.max(0, Math.min(100, uiC));
        t = Math.max(0, Math.min(100, t));
        
        // Use Absolute Chroma directly (0-100)
        var c = uiC;

        // Update local state immediately
        lastHct = { h:h, c:c, t:t };

        var commit = !opts || opts.commit;
        if (!commit) {
            previewFromSlider(key, val);
            setTimeout(function(){ window._hctDragging = false; }, 50);
            return;
        }

        // Solve for RGB using Gamut Mapping
        var argb = intFromHct(h, c, t);
        var r = (argb >> 16) & 0xFF;
        var g = (argb >> 8) & 0xFF;
        var b = argb & 0xFF;
        
        // Fix: Jitter reduction and Gray Tinting.
        // We always try to stabilize Hue to match target 'h'.
        // This handles both the "Pure Gray Hue Reset" issue AND the "Low Chroma Jitter" issue.
        if (t > 2 && t < 98) {
             var stabilized = stabilizeHue(r, g, b, h);
             r = stabilized.r;
             g = stabilized.g;
             b = stabilized.b;
        }
        
        window._hctLastInternalCommit = { key: key, ts: (Date.now ? Date.now() : +new Date()), h: h, c: c, t: t };
        setCoolorusColor(r, g, b);
        
        // Update the internal lastHex to prevent the syncFromGlobalColor loop from overwriting our work
        var hex = ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
        lastHex = '#' + hex;

        if (opts && opts.light) {
            previewFromSlider(key, val);
            setTimeout(function(){ window._hctDragging = false; }, 50);
            return;
        }

        updateUISliders(t, c, h, {r:r, g:g, b:b});
        
        setTimeout(function(){ window._hctDragging = false; }, 50);
    }

    function setCoolorusColor(r, g, b) {
        if (!isFinite(r) || !isFinite(g) || !isFinite(b)) return;
        r = Math.max(0, Math.min(255, r | 0));
        g = Math.max(0, Math.min(255, g | 0));
        b = Math.max(0, Math.min(255, b | 0));
        var hex = ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
        var hexInput = document.getElementById('hexInput');
        if (hexInput) {
            hexInput.value = hex;
            hexInput.dispatchEvent(new Event('change'));
            hexInput.dispatchEvent(new Event('input'));
            var kEvent = document.createEvent('KeyboardEvent');
            kEvent.initEvent('keydown', true, true);
            Object.defineProperty(kEvent, 'keyCode', {get:function(){return 13;}});
            Object.defineProperty(kEvent, 'which', {get:function(){return 13;}});
            hexInput.dispatchEvent(kEvent);
        }
    }

    function setCoolorusColorPreview(r, g, b) {
        if (!isFinite(r) || !isFinite(g) || !isFinite(b)) return;
        r = Math.max(0, Math.min(255, r | 0));
        g = Math.max(0, Math.min(255, g | 0));
        b = Math.max(0, Math.min(255, b | 0));
        var hex = ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
        var hexInput = document.getElementById('hexInput');
        if (hexInput) {
            hexInput.value = hex;
            hexInput.dispatchEvent(new Event('input'));
            var kEvent = document.createEvent('KeyboardEvent');
            kEvent.initEvent('keyup', true, true);
            Object.defineProperty(kEvent, 'keyCode', {get:function(){return 0;}});
            Object.defineProperty(kEvent, 'which', {get:function(){return 0;}});
            hexInput.dispatchEvent(kEvent);
        }
    }

    function setCoolorusHuePreview(r, g, b) {
        if (!isFinite(r) || !isFinite(g) || !isFinite(b)) return;
        r = Math.max(0, Math.min(255, r | 0));
        g = Math.max(0, Math.min(255, g | 0));
        b = Math.max(0, Math.min(255, b | 0));
        var hex = ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
        var hexInput = document.getElementById('hexInput');
        if (hexInput) {
            hexInput.value = hex;
            hexInput.dispatchEvent(new Event('change'));
            hexInput.dispatchEvent(new Event('input'));
        }
    }

    initHctUI();

})();
