export function globToRegExp(glob) {
  let source = '^';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === '*') {
      if (glob[index + 1] === '*') { source += '.*'; index += 1; }
      else source += '[^/]*';
    } else if (char === '?') source += '[^/]';
    else source += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  }
  return new RegExp(`${source}$`);
}

export function matchesGlob(value, pattern) {
  return globToRegExp(pattern.replaceAll('\\', '/')).test(value.replaceAll('\\', '/'));
}

export function matchesAny(value, patterns = []) {
  return patterns.some((pattern) => matchesGlob(value, pattern));
}
