import axios from 'axios';
import { HitomiFields } from 'src/shared/enums/HitomiFields';
import { chunkArray } from 'src/shared/utils';
import * as cheerio from 'cheerio';

export const findDuplicateTitle = async (
  detailsData: Record<HitomiFields, any>,
): Promise<boolean> => {
  try {
    if (detailsData) {
      if (detailsData.languages?.length && detailsData.title[0]) {
        const dataToCheck = {} as Record<string, { name: string } | string>;
        dataToCheck.language = { name: detailsData.languages[0] };
        dataToCheck.title = detailsData.title[0];
        const { data: isDuplicate } = await axios.post(
          `${process.env.CLIENT_SERVER_URL}/albums/find-duplicate`,
          dataToCheck,
        );
        return isDuplicate;
      }
    }
    return false;
  } catch (e) {
    throw e;
  }
};

export const checkIfBannedTitle = async (
  detailsData: Record<HitomiFields, any>,
): Promise<boolean> => {
  try {
    if (detailsData) {
      if (detailsData.title[0]) {
        const { data } = await axios.post<{ id: string; name: string }>(
          `${process.env.CLIENT_SERVER_URL}/blocked-albums/check`,
          { name: detailsData.title[0] },
        );
        return !!data.id;
      }
    }
    return false;
  } catch (e) {
    console.log(detailsData, 'data');
    throw e;
  }
};

export const allowToParse = ({
  detailsData,
  isDuplicate,
  isBanned,
}: {
  detailsData: Record<string, any>;
  isDuplicate: boolean;
  isBanned: boolean;
}) => {
  return (
    detailsData &&
    !isDuplicate &&
    !isBanned &&
    detailsData.languages.length &&
    detailsData.images.length > 40 &&
    (detailsData.type[0] === 'game CG'
      ? detailsData.images.length < 2000
      : detailsData.images.length < 1000)
  );
};

export const extendDetailsData = ({ downloadPath, imageData }) => {
  const detailsData: Record<string, any> = {};
  detailsData.downloadPath = downloadPath;
  detailsData.previewOrientation =
    imageData[0]?.width > imageData[0]?.length ? 'horizontal' : 'vertical';
  detailsData.totalImages = imageData.length;
  detailsData.preview = imageData[0].url;
  return detailsData;
};

export const sendImages = async ({
  imageData,
  detailsData,
  albumId,
  albumIndex,
}): Promise<string> => {
  const isRequestOversized = imageData.length > 100;
  const album = await axios.post(
    `${process.env.CLIENT_SERVER_URL}/albums/scrapper-album`,
    {
      albumData: isRequestOversized
        ? { ...detailsData, images: [] }
        : { ...detailsData, images: imageData },
      albumPath: `images/${albumId}`,
      albumIndex,
    },
  );
  if (isRequestOversized) {
    for (const chunk of chunkArray(imageData, 50)) {
      await axios.post(
        `${process.env.CLIENT_SERVER_URL}/albums/scrapper-album-images`,
        {
          images: chunk,
          albumId: album.data,
        },
      );
    }
  }
  const albumUrl = `${process.env.CLIENT_URL}/album/${album.data}/`;
  return albumUrl;
};

const extractTitleLink = async (url: string) => {
  try {
    const htmlData = await axios.get(url);
    const $ = cheerio.load(htmlData.data);
    const titleReferenceLink = $('div.seriesmeta a').attr('href');
    return titleReferenceLink;
  } catch (error) {
    console.log('extractTitleLink', error);
    return null;
  }
};

const extractTableTitleLink = async (url: string) => {
  try {
    const htmlData = await axios.get(url);
    const $ = cheerio.load(htmlData.data);
    const titleReferenceLink = $('div.seriesmeta a').attr('href');
    return titleReferenceLink;
  } catch (error) {
    console.log('extractTableTitleLink', error);
    return null;
  }
};

export const selectVideoReferencesToParse = async ({
  url,
}: {
  url: string;
}) => {
  try {
    const htmlData = await axios.get(url);
    const titleReferenceLinks = [];
    const $ = cheerio.load(htmlData.data);
    const listContentClass = 'div.nag div.item';
    const videoUrls = $(listContentClass)
      .map((i, item) => $(item).find('div.data h2 a').attr('href'))
      .get()
      .reverse();
    for (const videoUrl of videoUrls) {
      try {
        console.log('reading:', videoUrl);
        const videoHtmlData = await axios.get(videoUrl);
        const $episodeVideo = cheerio.load(videoHtmlData.data);
        const episodeLinks = $episodeVideo('div#linkwrapper table tbody tr')
          .map((_, item) => {
            const url = $(item).find('a').attr('href');
            if (url) {
              return `${process.env.VIDEO_SCRAPPER_HOST}/${url}`;
            }
          })
          .get();
        const isTableType = !!episodeLinks?.length;
        if (isTableType) {
          if (episodeLinks[0]?.includes('episode-list')) {
            titleReferenceLinks.push(episodeLinks[0]);
          } else {
            const titleReferenceLink = await extractTableTitleLink(
              episodeLinks[0],
            );
            if (titleReferenceLink) {
              titleReferenceLinks.push(titleReferenceLink);
            }
          }
        } else {
          const titleReferenceLink = await extractTitleLink(videoUrl);
          if (titleReferenceLink) {
            titleReferenceLinks.push(titleReferenceLink);
          }
        }
      } catch (e) {
        console.log('selectVideoReferencesToParse', videoUrl);
      }
    }
    return titleReferenceLinks;
  } catch (error) {
    console.log('selectVideoReferencesToParse', error);
    return [];
  }
};

const extractVideoUrl = async ({
  url,
  title,
}: {
  url: string;
  title: string;
}) => {
  try {
    const htmlData = await axios.get(url);
    const $ = cheerio.load(htmlData.data);
    const videoSrc =
      $('#fluid_video_wrapper_my-video video.fluidplayer source').attr('src') ||
      $("source[type='video/mp4']").attr('src');
    if (videoSrc.startsWith('https://') && videoSrc.endsWith('mp4')) {
      return videoSrc;
    } else {
      console.log('broken url', title, url, videoSrc);
      return null;
    }
  } catch (e) {
    console.log('extractVideoUrl', e, url);
    return null;
  }
};

export const extractTitlesData = async (titleReferenceLinks: string[]) => {
  const resultMap = new Map<
    string,
    { title: string; videos: { url: string; episodeIndex: number }[] }
  >();
  console.log(titleReferenceLinks, 'titleReferenceLinks');
  for (const titleReferenceLink of titleReferenceLinks) {
    try {
      const titleHtmlData = await axios.get(titleReferenceLink);
      const $ = cheerio.load(titleHtmlData.data);
      const title = $('div.loop-header h1.loop-title em').text();
      const listContentClass = 'div.nag div.item';
      const episodeUrls = $(listContentClass)
        .map((i, item) => $(item).find('div.data h2 a').attr('href'))
        .get()
        .reverse();
      const videos = [];
      let episodeIndex = 1;
      for (const episodeUrl of episodeUrls.reverse()) {
        const videoUrl = await extractVideoUrl({ url: episodeUrl, title });
        if (videoUrl) {
          videos.push({ url: videoUrl, episodeIndex });
        }
        episodeIndex++;
      }
      resultMap.set(title, { title, videos });
    } catch (error) {
      console.log('extractTitlesData', error.response, titleReferenceLink);
    }
  }
  return resultMap;
};
