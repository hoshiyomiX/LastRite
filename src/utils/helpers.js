import { FLAG_EMOJI_CACHE } from '../core/state.js';

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function base64ToArrayBuffer(base64Str) {
  if (!base64Str) {
    return { error: null };
  }
  try {
    base64Str = base64Str.replace(/-/g, "+").replace(/_/g, "/");
    const decode = atob(base64Str);
    const arryBuffer = Uint8Array.from(decode, (c) => c.charCodeAt(0));
    return { earlyData: arryBuffer.buffer, error: null };
  } catch (error) {
    return { error };
  }
}

export function arrayBufferToHex(buffer) {
  return [...new Uint8Array(buffer)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function shuffleArray(array) {
  let currentIndex = array.length;
  while (currentIndex != 0) {
    let randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;
    [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
  }
}

export function getFlagEmoji(isoCode) {
  const codePoints = isoCode
    .toUpperCase()
    .split("")
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

export function getFlagEmojiCached(isoCode) {
  if (!FLAG_EMOJI_CACHE.has(isoCode)) {
    FLAG_EMOJI_CACHE.set(isoCode, getFlagEmoji(isoCode));
  }
  return FLAG_EMOJI_CACHE.get(isoCode);
}

export function paginateArray(array, offset, limit, filterCC) {
  let filtered = array;
  
  // Apply country filter
  if (filterCC.length > 0) {
    filtered = array.filter((prx) => filterCC.includes(prx.country));
  }
  
  // Shuffle for randomization
  shuffleArray(filtered);
  
  const total = filtered.length;
  const paginated = filtered.slice(offset, offset + limit);
  
  return {
    data: paginated,
    pagination: {
      offset,
      limit,
      total,
      hasMore: (offset + limit) < total,
      nextOffset: (offset + limit) < total ? offset + limit : null,
    },
  };
}
