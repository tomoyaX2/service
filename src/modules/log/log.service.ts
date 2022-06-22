import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as moment from 'moment';

@Injectable()
export class LogService {
  parentLogDir = 'log';
  logData = { logPath: '', text: '' };

  createLogFile = async (path: string) => {
    if (process.env.ENABLE_LOGS === 'false') {
      return;
    }
    const logPath = `${this.parentLogDir}/${path}_${moment(new Date())
      .format()
      .split(':')
      .join('_')
      .replace('+', '_')}.txt`;
    if (!fs.existsSync(this.parentLogDir)) {
      fs.mkdirSync(this.parentLogDir);
    }
    await fs.appendFile(logPath, 'START', (err) => {
      if (err) {
        console.warn('create log failed');
      } else {
        console.warn('create log succeed');
      }
    });
    this.logData = { logPath, text: '' };
  };

  saveLog = (text: string, variant: 'warn' | 'log' = 'log') => {
    console[variant](text);
    if (process.env.ENABLE_LOGS === 'false') {
      return;
    }
    this.logData = { ...this.logData, text };
    const stream = fs.createWriteStream(this.logData.logPath, {
      flags: 'a', // 'a' means appending (old data will be preserved)
    });
    stream.write(`\n${text} - ${moment(new Date()).format()}`);
    stream.end();
  };
}
