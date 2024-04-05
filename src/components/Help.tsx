import { Modal } from "../flowbite";
import React, { memo, useCallback, useContext, useState } from "react";
import localizationContext from "../localizationContext";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useAppDispatch, useAppSelector } from "../hooks";
import { setIsHelpOpen } from "../appSlice";

const helpLocs = [
  ["faqFirstH", "faqFirstC"],
  ["faqSecondH", "faqSecondC"],
  ["faqSixthH", "faqSixthC"],
  ["faqThirdH", "faqThirdC1", "faqThirdC2", "faqThirdC3", "faqThirdC4", "faqThirdC5"],
  ["faqSeventhH", "faqSeventhC"],
  ["faqFourthH", "faqFourthC1", "faqFourthC2"],
  ["faqNinthH", "faqNinthC1", "faqNinthC2"],
  ["faqEightH", "faqEightC"],
  ["faqFifthH", "faqFifthC1", "faqFifthC2", "faqFifthC3", "faqFifthC4", "faqFifthC5", "faqFifthC6"],
  ["faqTenthH", "faqTenthC"],
  ["faqEleventhsH", "faqEleventhsC"],
];

const knownIssuesLocs = [
  ["faqIssuesFirstH", "faqIssuesFirstC"],
  ["faqIssuesSecondH", "faqIssuesSecondC"],
  ["faqIssuesThirdH", "faqIssuesThirdC"],
];

const Help = memo(() => {
  const dispatch = useAppDispatch();
  const localized: Record<string, string> = useContext(localizationContext);
  const isHelpOpen = useAppSelector((state) => state.app.isHelpOpen);

  return (
    <>
      {isHelpOpen && (
        <Modal
          show={isHelpOpen}
          // show={true}
          onClose={() => dispatch(setIsHelpOpen(false))}
          size="2xl"
          position="top-center"
          explicitClasses={[
            "mt-8",
            "!max-w-5xl",
            "md:!h-full",
            ..."scrollbar scrollbar-track-gray-700 scrollbar-thumb-blue-700".split(" "),
            "modalDontOverflowWindowHeight",
          ]}
        >
          <Modal.Header>
            <span className="max-w-5xl">{localized.faq}</span>
          </Modal.Header>

          <Modal.Body>
            <div className="flex justify-center">
              <Accordion type="single" collapsible className="w-11/12">
                {helpLocs.map((locHeaderAndContent, i) => (
                  <AccordionItem key={`item-${i}`} value={`item-${i}`}>
                    <AccordionTrigger>{localized[locHeaderAndContent[0]]}</AccordionTrigger>
                    <AccordionContent>
                      {locHeaderAndContent.slice(1).map((loc, ii) => (
                        <p key={`${i}_${ii}`} className="[&:not(:first-child)]:mt-4">
                          {localized[loc]}
                        </p>
                      ))}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>

            <div className="text-gray-100 font-semibold m-auto text-xl mt-12">{localized.knownIssues}</div>
            <div className="flex justify-center mt-4">
              <Accordion type="single" collapsible className="w-11/12">
                {knownIssuesLocs.map((locHeaderAndContent, i) => (
                  <AccordionItem key={`item-${i}`} value={`item-${i}`}>
                    <AccordionTrigger>{localized[locHeaderAndContent[0]]}</AccordionTrigger>
                    <AccordionContent>
                      {locHeaderAndContent.slice(1).map((loc, ii) => (
                        <p key={`${i}_${ii}`} className="[&:not(:first-child)]:mt-4">
                          {localized[loc]}
                        </p>
                      ))}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          </Modal.Body>
        </Modal>
      )}
    </>
  );
});

export default Help;
