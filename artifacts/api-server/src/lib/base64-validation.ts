const isBase64Character = (code: number): boolean =>
  (code >= 65 && code <= 90) ||
  (code >= 97 && code <= 122) ||
  (code >= 48 && code <= 57) ||
  code === 43 ||
  code === 47;

/**
 * Validate Base64 in one linear pass, avoiding regex backtracking/stack use
 * on large upload bodies. Legacy imports may omit or use loose padding.
 */
export function isValidBase64String(
  value: string,
  options: { allowUnpadded?: boolean } = {},
): boolean {
  if (!value.length) return false;

  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const dataEnd = value.length - padding;
  if (dataEnd === 0) return false;
  if (!options.allowUnpadded && (
    value.length % 4 !== 0 ||
    (padding === 1 && dataEnd % 4 !== 3) ||
    (padding === 2 && dataEnd % 4 !== 2)
  )) {
    return false;
  }

  for (let index = 0; index < dataEnd; index++) {
    if (!isBase64Character(value.charCodeAt(index))) return false;
  }
  for (let index = dataEnd; index < value.length; index++) {
    if (value.charCodeAt(index) !== 61) return false;
  }
  return true;
}
