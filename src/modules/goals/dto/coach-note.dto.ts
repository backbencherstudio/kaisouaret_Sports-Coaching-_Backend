import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { GOALS_CONFIG } from '../goals.constants';

export class AddCoachNoteDto {
  @IsNotEmpty({ message: 'Coach note is required' })
  @IsString({ message: 'Coach note must be a string' })
  @MaxLength(GOALS_CONFIG.NOTE_MAX_LENGTH, {
    message: `Note cannot exceed ${GOALS_CONFIG.NOTE_MAX_LENGTH} characters`,
  })
  note: string;
}

export class AssignCoachDto {
  @IsNotEmpty({ message: 'Coach ID is required' })
  @IsString({ message: 'Coach ID must be a string' })
  coach_id: string;
}
