export const findCurrentVideoQualityFromUrl = (url: string) => {
  if (url.includes('480p')) {
    return '480p';
  }
  if (url.includes('720p')) {
    return '720p';
  }
  if (url.includes('1080p')) {
    return '1080p';
  }
};

export const removeQualityIndexFromUrl = (url: string) => {
  return url.replace('480p', '').replace('720p', '').replace('1080p', '');
};
