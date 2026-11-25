import "./footer.css";
import underLogo from "../assets/ohsunggo_under.png";

const Footer = () => {
  return (
    <footer className="home-footer">
      <div className="home-footer__inner">
        <div className="home-footer__brand">
          <img src={underLogo} alt="오성고 로고" className="home-footer__logo" />
          <div>
            <p className="home-footer__title">빌리러 오성</p>
            <p className="home-footer__subtitle">천안오성고 학생회</p>
          </div>
        </div>

        <div className="home-footer__links">
          <a
            href="https://www.instagram.com/os.20_sc/"
            target="_blank"
            rel="noreferrer"
          >
            학생회 인스타그램
          </a>
        </div>

        <p className="home-footer__copyright">
          © {new Date().getFullYear()} Ohsung Rental. All rights reserved.
        </p>
      </div>
    </footer>
  );
};

export default Footer;
