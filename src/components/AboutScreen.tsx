import { Modal } from "../flowbite/components/Modal/index";
import React, { memo, useContext } from "react";
import { FaGithub, FaSteam, FaPaypal, FaPatreon } from "react-icons/fa";
import { Tooltip } from "flowbite-react";
import appPackage from "../../package.json";
import localizationContext from "../localizationContext";

export interface AboutScreenProps {
  isOpen: boolean;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

const AboutScreen = memo(({ isOpen, setIsOpen }: AboutScreenProps) => {
  const localized: Record<string, string> = useContext(localizationContext);

  return (
    <>
      {isOpen && (
        <Modal
          onClose={() => {
            setIsOpen(false);
          }}
          show={true}
          size="2xl"
          position="center"
          explicitClasses={["!max-w-7xl"]}
        >
          <Modal.Header>{localized.about}</Modal.Header>
          <Modal.Body>
            <div className="flex flex-col gap-y-6 gap-x-4 z-10 leading-relaxed dark:text-gray-300 relative font-normal items-center">
              <div className="w-full flex flex-col gap-y-6">
                <div className="text-gray-100 font-bold m-auto text-2xl">Warhammer 3 Mod Manager</div>
                <div className="text-gray-200 font-semibold m-auto text-xl -my-2">{`Version ${appPackage.version}`}</div>
                <div className="text-gray-200 font-semibold m-auto text-xl">{localized.byAuthor}</div>
                <div className="flex m-auto gap-x-4">
                  <div>
                    <Tooltip
                      style={"light"}
                      content={<p>https://steamcommunity.com/sharedfiles/filedetails/?id=2845454582</p>}
                    >
                      <a
                        href="https://steamcommunity.com/sharedfiles/filedetails/?id=2845454582"
                        target="_blank"
                      >
                        <FaSteam size="3rem" />
                      </a>
                    </Tooltip>
                  </div>
                  <div>
                    <Tooltip style={"light"} content={<p>https://github.com/Shazbot/WH3-Mod-Manager</p>}>
                      <a href="https://github.com/Shazbot/WH3-Mod-Manager" target="_blank">
                        <FaGithub size="3rem" />
                      </a>
                    </Tooltip>
                  </div>
                </div>
              </div>
              <div className="border border-gray-600 w-[75%]"></div>
              <div className="w-full flex flex-col gap-y-4">
                <p className="m-auto text-gray-300 font-medium text-l">{localized.coffee}</p>
                <div className="flex gap-x-4 m-auto">
                  <div>
                    <Tooltip style={"light"} content={<p>https://www.patreon.com/propjoe</p>}>
                      <a href="https://www.patreon.com/propjoe" target="_blank">
                        <FaPatreon size="3rem" />
                      </a>
                    </Tooltip>
                  </div>
                  <div>
                    <Tooltip style={"light"} content={<p>https://paypal.me/propjoe123</p>}>
                      <a href="https://paypal.me/propjoe123" target="_blank">
                        <FaPaypal size="3rem" />
                      </a>
                    </Tooltip>
                  </div>
                </div>
              </div>
            </div>
          </Modal.Body>
        </Modal>
      )}
    </>
  );
});
export default AboutScreen;
