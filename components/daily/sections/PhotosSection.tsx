'use client';

import PhotoUploadGrid from '@/components/weekly/PhotoUploadGrid';
import { RowButton, SectionRow, type SectionProps } from '../SectionRow';

export default function PhotosSection({ report, state, open, onToggle, onOpen }: SectionProps) {
  const n = report.photos.filter(Boolean).length;
  return (
    <SectionRow
      id="photos"
      title="Photos"
      summary={n > 0 ? `${n} of ${report.photos.length} photos` : 'No photos yet'}
      state={state}
      open={open}
      onToggle={onToggle}
      actions={n === 0 ? <RowButton onClick={onOpen}>Add photo</RowButton> : undefined}
    >
      <PhotoUploadGrid compact photos={report.photos} uploadUrl={`/api/daily/${report.date}/photos`} />
    </SectionRow>
  );
}
