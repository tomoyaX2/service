import { exec } from 'child_process';

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

export const addLeadingZeros = (number, digits) => {
  const numberString = number.toString();
  const zerosToAdd = digits - numberString.length;

  if (zerosToAdd <= 0) {
    return numberString;
  }

  const leadingZeros = '0'.repeat(zerosToAdd);
  return leadingZeros + numberString;
};

export const executeCommand = (command) => {
  console.log('command, ', command);
  return new Promise((resolve, reject) => {
    const childProcess = exec(command, (error, stdout, stderr) => {
      if (error) {
        console.log('rpcess error');
        reject(error);
      } else {
        console.log('rpcess success');
        resolve({ stdout, stderr });
      }
    });

    childProcess.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });
  });
};
