import { useEffect } from "react";
import MercuryLockup from "../../components/common/MercuryLockup";

interface SplashScreenProps {
  onFinished: () => void;
}

function SplashScreen({ onFinished }: SplashScreenProps): React.JSX.Element {
  useEffect(() => {
    onFinished();
  }, [onFinished]);

  return (
    <div className="splash-screen">
      <MercuryLockup className="splash-lockup" />
    </div>
  );
}

export default SplashScreen;
