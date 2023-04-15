import { Injectable } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class CleanupService {
  token = '';

  init = async () => {
    const response = await axios.post<{ accessToken: string }>(
      `${process.env.CLIENT_SERVER_URL}/auth/login`,
      { login: process.env.ADMIN_LOGIN, password: process.env.ADMIN_PASS },
    );
    console.log(response.data.accessToken, 'response.data.accessToken');
    this.token = response.data.accessToken;
  };

  cleanup = async () => {
    const authorIdsToDelete = [];
    const authorsResponse = await axios.get(
      `${process.env.CLIENT_SERVER_URL}/authors`,
    );
    const series = await axios.get(`${process.env.CLIENT_SERVER_URL}/series`);
    const tags = await axios.get(`${process.env.CLIENT_SERVER_URL}/tags`);
    for (const author of authorsResponse.data.data.slice(0, 10)) {
      const albumsData = await axios.post<{ total: number }>(
        `${process.env.CLIENT_SERVER_URL}/albums/search`,
        { page: 1, perPage: 1, authors: [author.id] },
      );
      if (!albumsData.data.total) {
        authorIdsToDelete.push(author.id);
      }
    }
    await axios.delete(
      `${
        process.env.CLIENT_SERVER_URL
      }/authors?authorIds=${authorIdsToDelete.join(',')}`,
      { headers: { access_token: this.token } },
    );
  };
}
