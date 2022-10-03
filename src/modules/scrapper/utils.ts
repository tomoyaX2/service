import axios from 'axios';
import { HitomiFields } from 'src/shared/enums/HitomiFields';
import { chunkArray } from 'src/shared/utils';

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
        const { data } = await axios.post<{ name: string; link: string }[]>(
          `${process.env.CLIENT_SERVER_URL}/blocked-albums/check`,
          { name: detailsData.title[0] },
        );
        return !!data.length;
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
    detailsData.images.length > 20 &&
    detailsData.images.length < 800
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
