import { IsString, MaxLength, MinLength } from 'class-validator';

export class AddSynonymDto {
  @IsString()
  @MinLength(1)
  @MaxLength(191)
  term: string;

  /** Comma-separated synonyms, as the search engine stores them. */
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  synonyms: string;
}
