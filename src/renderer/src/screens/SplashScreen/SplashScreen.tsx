import { useEffect } from "react";
import splashBg from "../../assets/splash.png";

interface SplashScreenProps {
  onFinished: () => void;
}

function SplashScreen({ onFinished }: SplashScreenProps): React.JSX.Element {
  useEffect(() => {
    onFinished();
  }, [onFinished]);

  return (
    <div className="splash-screen">
      <img className="splash-bg" src={splashBg} alt="" />
      <div className="splash-logo" aria-label="Mercury">
        Mercury
      </div>
    </div>
  );
}

export default SplashScreen;
