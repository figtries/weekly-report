import { SetPasswordScreen } from '@/components/login/SetPasswordScreen';
import { RouteTransition } from '@/components/motion/RouteTransition';

export const metadata = { title: 'Set password' };

export default function SetPasswordPage() {
  return (
    <RouteTransition id="set-password">
      <SetPasswordScreen />
    </RouteTransition>
  );
}
