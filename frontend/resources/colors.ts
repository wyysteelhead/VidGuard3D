import * as THREE from 'three';

export const MIN_LIGHTNESS = 45;
export const MID_LIGHTNESS = 64;
export const MAX_LIGHTNESS = 90;

export const BASE_COLOR_RISK = {
  hue: 5,
  saturation: 85,
  lightness: MID_LIGHTNESS,
};
export const RED_BLUE_COLOR_RISK = {
  hue: 5,
  saturation: 85,
  lightness: MID_LIGHTNESS,
};
const BASE_COLOR_PRIMARY = {
  hue: 40,
  saturation: 85,
  lightness: MID_LIGHTNESS,
};
const BASE_COLOR_SELECTION = {
  hue: 35,
  saturation: 85,
  lightness: MID_LIGHTNESS,
};
const ERROR_COLOR_RGB = {
  red: 0,
  green: 255,
  blue: 0,
};

export function getColorByRisk(risk) {
  if (riskIsInvalid(risk)) {
    return `rgb(${ERROR_COLOR_RGB.red},${ERROR_COLOR_RGB.green},${ERROR_COLOR_RGB.blue})`;
  }
  const { red, green, blue } = hslToRgb(
    BASE_COLOR_RISK.hue,
    BASE_COLOR_RISK.saturation,
    querpLightness(risk),
  );
  return `rgb(${red},${green},${blue})`;
}

export function getColorSelectionRgba(alpha = 1) {
  const { red, green, blue } = hslToRgb(
    BASE_COLOR_SELECTION.hue,
    BASE_COLOR_SELECTION.saturation,
    BASE_COLOR_SELECTION.lightness,
  );
  return `rgba(
    ${red},
    ${green},
    ${blue},
    ${alpha})`;
}

export function getColorDeletedRgba(alphaDecimal = 1) {
  const { red, green, blue } = hslToRgb(
    BASE_COLOR_SELECTION.hue,
    0,
    BASE_COLOR_SELECTION.lightness,
  );
  return `rgba(${red},${green},${blue},${alphaDecimal})`;
}

export function getThreeJsColorByRisk(risk) {
  if (riskIsInvalid(risk)) {
    return new THREE.Color(
      ERROR_COLOR_RGB.red / 255,
      ERROR_COLOR_RGB.green / 255,
      ERROR_COLOR_RGB.blue / 255,
    );
  }
  const { red, green, blue } = hslToRgb(
    // BASE_COLOR_RISK.hue,
    querpHue(risk),
    BASE_COLOR_RISK.saturation,
    querpLightness(risk),
  );
  return new THREE.Color(red / 255, green / 255, blue / 255);
}

export function getThreeJsColorSelection() {
  const { red, green, blue } = hslToRgb(
    BASE_COLOR_SELECTION.hue,
    BASE_COLOR_SELECTION.saturation,
    BASE_COLOR_SELECTION.lightness,
  );
  return new THREE.Color(red / 255, green / 255, blue / 255);
}

export function getThreeJsColorDeleted() {
  const { red, green, blue } = hslToRgb(
    BASE_COLOR_SELECTION.hue,
    0,
    BASE_COLOR_SELECTION.lightness,
  );
  return new THREE.Color(red / 255, green / 255, blue / 255);
}

export function getPrimaryColor(lightnessDelta = 0) {
  const { red, green, blue } = hslToRgb(
    BASE_COLOR_PRIMARY.hue,
    BASE_COLOR_PRIMARY.saturation,
    BASE_COLOR_PRIMARY.lightness + lightnessDelta,
  );
  return `rgb(
    ${red},
    ${green},
    ${blue})`;
}

function hslToRgb(hueDegrees, saturationPercent, lightnessPercent) {
  // Normalize H, S, L values
  const normHue = hueDegrees / 360;
  const normSaturation = saturationPercent / 100;
  const normLightness = lightnessPercent / 100;

  let r;
  let g;
  let b;

  if (normSaturation === 0) {
    // Achromatic (grayscale)
    r = normLightness;
    g = normLightness;
    b = normLightness;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      let newT = t;
      if (newT < 0) {
        newT += 1;
      }
      if (newT > 1) {
        newT -= 1;
      }
      if (newT < 1 / 6) {
        return p + (q - p) * 6 * newT;
      }
      if (newT < 1 / 2) {
        return q;
      }
      if (newT < 2 / 3) {
        return p + (q - p) * (2 / 3 - newT) * 6;
      }
      return p;
    };

    const q =
      normLightness < 0.5
        ? normLightness * (1 + normSaturation)
        : normLightness + normSaturation - normLightness * normSaturation;
    const p = 2 * normLightness - q;

    r = hue2rgb(p, q, normHue + 1 / 3);
    g = hue2rgb(p, q, normHue);
    b = hue2rgb(p, q, normHue - 1 / 3);
  }

  // Convert to 0-255 range and round to integers
  return {
    red: Math.round(r * 255),
    green: Math.round(g * 255),
    blue: Math.round(b * 255),
  };
}

// function lerpLightness(value, start = MAX_LIGHTNESS, end = MIN_LIGHTNESS) {
//   return value * (end - start) + start;
// }

function querpLightness(
  value,
  start = MAX_LIGHTNESS,
  end = MIN_LIGHTNESS,
  mid = MID_LIGHTNESS,
) {
  return (
    2 * start * value ** 2 -
    3 * start * value +
    start -
    4 * mid * value ** 2 +
    4 * mid * value +
    2 * end * value ** 2 -
    end * value
  );
}

// function querpLightness(
//   value,
//   start = MAX_LIGHTNESS,
//   end = MIN_LIGHTNESS,
//   mid = MID_LIGHTNESS,
// ) {
//   if (value > 0.3) {
//     // Range [1, 0.3]: interpolate from start to mid.
//     const t = (value - 0.3) / 0.7; // Normalize [1, 0.3] into [0, 1].
//     return (
//       2 * start * t ** 2 -
//       3 * start * t +
//       start -
//       4 * mid * t ** 2 +
//       4 * mid * t +
//       2 * mid * t ** 2 -
//       mid * t
//     );
//   } else {
//     // Range [0.3, 0]: interpolate from end to mid.
//     const t = value / 0.3; // Normalize [0.3, 0] into [0, 1].
//     return (
//       2 * end * t ** 2 -
//       3 * end * t +
//       end -
//       4 * mid * t ** 2 +
//       4 * mid * t +
//       2 * mid * t ** 2 -
//       mid * t
//     );
//   }
// }


function querpHue(value, start = 5, end = 200) {
  return start;
  // // Keep hue at red (5) when risk > 0.3.
  // if (value > 0.3) {
  //   return start;
  // }
  // // Switch hue to blue (200) when risk <= 0.3.
  // return end;
}

// function rgbToHex(r, g, b) {
//   const red = r.toString(16).padStart(2, '0');
//   const green = g.toString(16).padStart(2, '0');
//   const blue = b.toString(16).padStart(2, '0');

//   return `#${red}${green}${blue}`;
// }

function riskIsInvalid(risk) {
  return typeof risk !== 'number' || risk < 0 || risk > 1 || Number.isNaN(risk);
}

export function buildTailwindPrimaryColors() {
  return {
    DEFAULT: getPrimaryColor(0),
    lightest: getPrimaryColor(20),
    lighter: getPrimaryColor(12),
    light: getPrimaryColor(5),
    dark: getPrimaryColor(-5),
    darker: getPrimaryColor(-12),
    darkest: getPrimaryColor(-20),
  };
}
