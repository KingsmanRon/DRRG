import Image from "next/image";
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

  return (
    <div className="practiceLetterhead" aria-label="Practice letterhead">
      <p className="practiceName">{practice.tradingName}</p>
      <p className="practiceDoctor">
        {practice.doctorName}
        <br />
        <span className="practiceQuals">{practice.qualifications}</span>
      </p>
      <p className="practiceMeta">
        PR No: {practice.practiceNumber}
        <span className="practiceDot" aria-hidden="true">
          ·
        </span>
        MP No: {practice.mpNumber}
      </p>
      <ul className="practiceContactList">
        <li>
          <span className="practiceLabel">Tel</span>
          <a href={practice.telHref}>{practice.tel}</a>
        </li>
        <li>
          <span className="practiceLabel">Cell / WhatsApp</span>
          <a href={practice.whatsappHref} target="_blank" rel="noopener noreferrer">
            {practice.cell}
          </a>
        </li>
        <li>
          <span className="practiceLabel">Email</span>
          <a href={practice.emailHref}>{practice.email}</a>
        </li>
      </ul>
      <p className="practiceAddress">
        {practice.physicalAddress}
        <br />
        {practice.postalAddress}
      </p>
    </div>
  );
}
