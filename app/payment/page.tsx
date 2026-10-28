import { RouteTransition } from '@/components/motion/RouteTransition';
import { PaymentScreen } from '@/components/payment/PaymentScreen';

export const metadata = { title: 'Payment' };

/**
 * Payment, the Master's last setup step before the app. Simulated until a
 * payment gateway and login exist (board item 22): nothing is charged.
 */
export default function PaymentPage() {
  return (
    <RouteTransition id="payment">
      <PaymentScreen />
    </RouteTransition>
  );
}
