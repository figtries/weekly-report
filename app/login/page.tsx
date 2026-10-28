import { LoginScreen } from '@/components/login/LoginScreen';
import { RouteTransition } from '@/components/motion/RouteTransition';

export const metadata = { title: 'Sign in' };

/**
 * Sign in. A draft until login exists (board item 22): accounts are issued by
 * the Master on Roles, so there is no sign-up, and nothing here checks anything.
 */
export default function LoginPage() {
  return (
    <RouteTransition id="login">
      <LoginScreen />
    </RouteTransition>
  );
}
