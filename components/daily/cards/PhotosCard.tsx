'use client';

import { Camera } from 'lucide-react';
import PhotoUploadGrid from '@/components/weekly/PhotoUploadGrid';
import { CardButton, SectionCard, type CardProps } from '../SectionCard';

export default function PhotosCard({ report, state, open, onToggle, onOpen }: CardProps) {
  const n = report.photos.filter(Boolean).length;
  return (
    <SectionCard
      id="photos"
      icon={<Camera className="size-[18px]" />}
      title="Photos"
      summary={`${n} of ${report.photos.length} photos`}
      chipLabel={n > 0 ? `${n} of ${report.photos.length}` : undefined}
      state={state}
      open={open}
      onToggle={onToggle}
      actions={
        n === 0 ? (
          <CardButton variant="default" onClick={onOpen}>
            Add photo
          </CardButton>
        ) : undefined
      }
    >
      <PhotoUploadGrid photos={report.photos} uploadUrl={`/api/daily/${report.date}/photos`} />
    </SectionCard>
  );
}
