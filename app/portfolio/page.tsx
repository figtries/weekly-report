import { redirect } from 'next/navigation';

/**
 * Moved to /projects.
 *
 * A redirect rather than a deletion: this URL is in people's history and in the
 * sidebar of every build before this one. The page that used to live here was a
 * cross-project money table — that job now belongs to the monthly dashboard
 * (board item 19), not to the screen where projects are kept.
 */
export default function PortfolioPage() {
  redirect('/projects');
}
