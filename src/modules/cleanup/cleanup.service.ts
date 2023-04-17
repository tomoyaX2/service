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
    const idsToDelete = [];
    let index = 1500;
    const authorsResponse = await axios.get(
      `${process.env.CLIENT_SERVER_URL}/authors`,
    );
    // const seriesResponse = await axios.get(
    //   `${process.env.CLIENT_SERVER_URL}/series`,
    // );
    // const tagsResponse = await axios.get(
    //   `${process.env.CLIENT_SERVER_URL}/tags`,
    // );
    // const languagesResponse = await axios.get(
    //   `${process.env.CLIENT_SERVER_URL}/languages`,
    // );
    // const groupsResponse = await axios.get(
    //   `${process.env.CLIENT_SERVER_URL}/groups`,
    // );
    for (const item of authorsResponse.data.data.slice(1500, 2246)) {
      try {
        index++;
        const albumsData = await axios.post<{ total: number }>(
          `${process.env.CLIENT_SERVER_URL}/albums/search`,
          { page: 1, perPage: 1, authors: [item.id] },
        );
        if (!albumsData.data.total) {
          idsToDelete.push(item.id);
        }
        console.log(index, '/', authorsResponse.data.data.length);
      } catch (e) {}
    }
    await axios.delete(
      `${process.env.CLIENT_SERVER_URL}/authors?authorIds=${idsToDelete.join(
        ',',
      )}`,
      { headers: { access_token: this.token } },
    );
    console.log('done');
  };
}
