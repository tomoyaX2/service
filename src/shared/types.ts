import { AlbumFilters } from './enums/AlbumFilters';

export enum SelectorTypes {
  List = 'list',
  String = 'string',
  Images = 'images',
}

export interface SelectorArgs {
  selector: string;
  textFormatter?: (text: string) => string;
  type: SelectorTypes;
}

export interface DefaultPaginationQuery {
  page?: number;
  perPage?: number;
  [AlbumFilters.Name]?: string;
}
export interface AlbumPaginationQuery extends DefaultPaginationQuery {
  [AlbumFilters.Author]?: string[];
  [AlbumFilters.Series]?: string[];
  [AlbumFilters.Language]?: string[];
  [AlbumFilters.Group]?: string[];
  [AlbumFilters.Tag]?: string[];
}
