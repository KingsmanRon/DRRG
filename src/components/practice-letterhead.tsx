import Image from "next/image";
import {
  IdBadgeIcon,
  MailIcon,
  MapPinIcon,
  PhoneIcon,
  WhatsAppIcon,
} from "@/components/icons";
import { practice } from "@/lib/practice";
import logo from "../../public/logo.png";

type Variant = "full" | "footer";

export function PracticeLetterhead({ variant = "full" }: { variant?: Variant }) {
  if (variant === "footer") {
    return (
      <footer className="practiceFooter" aria-label="Practice contact details">
        <div className="practiceFooterInner">
          <Image
            className="practiceFooterLogo"
            src={logo}
            alt={practice.tradingName}
            priority={false}
          />
          <p className="practiceDoctor">
            {practice.doctorName}{" "}
            <span className="practiceQuals">{practice.qualifications}</span>
          </p>
          <p className="practiceMeta">
            PR No: {practice.practiceNumber}
            <span className="practiceDot" aria-hidden="true">
              ·
            </span>
            MP No: {practice.mpNumber}
          </p>
          <p className="practiceContacts">
            <a href={practice.telHref}>Tel: {practice.tel}</a>
            <span className="practiceDot" aria-hidden="true">
              ·
            </span>
            <a href={practice.cellHref}>Cell / WhatsApp: {practice.cell}</a>
            <span className="practiceDot" aria-hidden="true">
              ·
            </span>
            <a href={practice.emailHref}>{practice.email}</a>
          </p>
          <p className="practiceAddress">
            {practice.physicalAddress}
            <span className="practiceDot" aria-hidden="true">
              ·
            </span>
            {practice.postalAddress}
          </p>
        </div>
      </footer>
    );
  }

  // Login: brand logo sits above this block; no trading name / doctor name text.
  return (
    <div className="practiceLetterhead" aria-label="Practice contact details">
      <p className="practiceQualsLine">{practice.qualifications}</p>
      <ul className="practiceIconList">
        <li>
          <span className="practiceIcon" aria-hidden="true">
            <IdBadgeIcon size={16} />
          </span>
          <span>
            PR No: {practice.practiceNumber}
            <span className="practiceDot" aria-hidden="true">
              ·
            </span>
            MP No: {practice.mpNumber}
          </span>
        </li>
        <li>
          <span className="practiceIcon" aria-hidden="true">
            <PhoneIcon size={16} />
          </span>
          <a href={practice.telHref}>Tel: {practice.tel}</a>
        </li>
        <li>
          <span className="practiceIcon" aria-hidden="true">
            <WhatsAppIcon size={16} />
          </span>
          <a href={practice.whatsappHref} target="_blank" rel="noopener noreferrer">
            Cell / WhatsApp: {practice.cell}
          </a>
        </li>
        <li>
          <span className="practiceIcon" aria-hidden="true">
            <MailIcon size={16} />
          </span>
          <a href={practice.emailHref}>{practice.email}</a>
        </li>
        <li>
          <span className="practiceIcon" aria-hidden="true">
            <MapPinIcon size={16} />
          </span>
          <span>{practice.physicalAddress}</span>
        </li>
        <li>
          <span className="practiceIcon" aria-hidden="true">
            <MapPinIcon size={16} />
          </span>
          <span>{practice.postalAddress}</span>
        </li>
      </ul>
    </div>
  );
}
