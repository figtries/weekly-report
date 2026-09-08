import SectionSkeleton from '@/components/ui/SectionSkeleton';

/** Keeps this route cheap to prefetch and instant to paint — see app/settings/loading.tsx. */
export default function Loading() {
  return <SectionSkeleton />;
}
