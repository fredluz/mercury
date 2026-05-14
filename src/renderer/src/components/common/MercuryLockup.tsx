import type React from "react";
import icon from "../../assets/icon.png";

interface MercuryLockupProps {
  alt?: string;
  decorative?: boolean;
  className?: string;
}

function MercuryLockup({
  alt = "Mercury",
  decorative = false,
  className,
}: MercuryLockupProps): React.JSX.Element {
  return (
    <img
      src={icon}
      className={className ? `mercury-lockup ${className}` : "mercury-lockup"}
      alt={decorative ? "" : alt}
      aria-hidden={decorative || undefined}
    />
  );
}

export default MercuryLockup;
