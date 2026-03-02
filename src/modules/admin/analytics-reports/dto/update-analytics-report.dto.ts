import { PartialType } from '@nestjs/mapped-types';
import { CreateAnalyticsReportDto } from './create-analytics-report.dto';

export class UpdateAnalyticsReportDto extends PartialType(CreateAnalyticsReportDto) {}
