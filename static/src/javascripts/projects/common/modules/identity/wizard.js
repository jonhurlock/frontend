// @flow

import fastdom from 'lib/fastdom-promise';
import { scrollTo } from 'lib/scroller';

const completedClassname = 'identity-wizard--completed';
const introductionClassname = 'identity-wizard--introduction';
const pagerClassname = 'identity-wizard__controls-pager';
const nextButtonElClassname = 'js-identity-wizard__next';
const prevButtonElClassname = 'js-identity-wizard__prev';
const containerClassname = 'identity-wizard';

const stepClassname = 'identity-wizard__step';
const stepHiddenClassname = 'identity-wizard__step--hidden';
const stepOutClassname = 'identity-wizard__step--out';
const stepInClassname = 'identity-wizard__step--in';
const stepOutReverseClassname = 'identity-wizard__step--out-reverse';
const stepInReverseClassname = 'identity-wizard__step--in-reverse';
const stepTransitionClassnames = [
    stepInClassname,
    stepInReverseClassname,
    stepOutClassname,
    stepOutReverseClassname,
];

const wizardPageChangedEv = 'wizardPageChanged';

const ERR_WIZARD_INVALID_POSITION = 'Invalid position';

declare class PopStateEvent extends Event {
    state: Object;
}

const getPositionFromName = (
    wizardEl: HTMLElement,
    position: string
): number => {
    const pageEl = wizardEl.querySelector(
        `[data-wizard-step-name=${position}]`
    );
    if (pageEl && pageEl.parentElement && pageEl.parentElement.children) {
        return [...pageEl.parentElement.children].indexOf(pageEl);
    }

    throw new Error(ERR_WIZARD_INVALID_POSITION);
};

const getPositionName = (wizardEl: HTMLElement, step: number): string => {
    const stepEl = [...wizardEl.getElementsByClassName(stepClassname)][step];

    if (stepEl && stepEl.dataset && stepEl.dataset.wizardStepName) {
        return stepEl.dataset.wizardStepName;
    }

    return `step-${step}`;
};

const getIdentifier = (wizardEl: HTMLElement): Promise<string> =>
    fastdom.read(() => wizardEl.id || containerClassname);

const getPosition = (wizardEl: HTMLElement): Promise<number> =>
    Promise.resolve(parseInt(wizardEl.dataset.position, 10));

const getInfoObject = (
    wizardEl: HTMLElement,
    optionalPosition: ?number
): Promise<{| dispatcher: string, position: number, positionName: string |}> =>
    Promise.all([
        getIdentifier(wizardEl),
        optionalPosition || getPosition(wizardEl),
    ]).then(([wizardElIdentifier, position]) => ({
        dispatcher: wizardElIdentifier,
        position,
        positionName: getPositionName(wizardEl, position),
    }));

const pushBrowserState = (
    wizardEl: HTMLElement,
    position: number
): Promise<void> =>
    getInfoObject(wizardEl, position).then(stateObject =>
        window.history.pushState(stateObject, '')
    );

const updateBrowserState = (
    wizardEl: HTMLElement,
    position: number
): Promise<void> =>
    getInfoObject(wizardEl, position).then(stateObject =>
        window.history.replaceState(stateObject, '')
    );

const getDirection = (currentPosition: number, newPosition: number): string => {
    if (currentPosition < 0) {
        return 'none';
    } else if (currentPosition > newPosition) {
        return 'backwards';
    }
    return 'forwards';
};

// #? polyfill.io might struggle with multiple classnames on classList
const animateIncomingStep = (
    wizardEl: HTMLElement,
    stepEl: HTMLElement,
    direction: string
): Promise<void> =>
    fastdom.write(() => {
        stepEl.classList.remove(
            stepHiddenClassname,
            ...stepTransitionClassnames
        );
        if (direction !== 'none') {
            stepEl.classList.add(
                direction === 'forwards'
                    ? stepInClassname
                    : stepInReverseClassname
            );
        }
        setTimeout(() => {
            stepEl.classList.remove(...stepTransitionClassnames);
        }, 300);
    });

const animateOutgoingStep = (
    wizardEl: HTMLElement,
    stepEl: HTMLElement,
    direction: string
): Promise<void> =>
    fastdom.write(() => {
        stepEl.classList.remove(...stepTransitionClassnames);
        stepEl.classList.add(
            ...[
                stepHiddenClassname,
                direction === 'forwards'
                    ? stepOutClassname
                    : stepOutReverseClassname,
            ]
        );
        setTimeout(() => {
            stepEl.classList.remove(...stepTransitionClassnames);
        }, 300);
    });

const updateCounter = (wizardEl: HTMLElement): Promise<void> =>
    fastdom
        .read(() => [...wizardEl.getElementsByClassName(pagerClassname)])
        .then((pagerEls: Array<HTMLElement>) =>
            fastdom.write(() => {
                wizardEl.classList.toggle(
                    completedClassname,
                    parseInt(wizardEl.dataset.position, 10) >=
                        parseInt(wizardEl.dataset.length, 10) - 1
                );
                wizardEl.classList.toggle(
                    introductionClassname,
                    parseInt(wizardEl.dataset.position, 10) < 1
                );
                pagerEls.forEach((pagerEl: HTMLElement) => {
                    pagerEl.innerText = `${parseInt(
                        wizardEl.dataset.position,
                        10
                    ) + 1} / ${wizardEl.dataset.length}`;
                });
            })
        );

const updateFocus = (stepEl: HTMLElement): Promise<void> =>
    fastdom.write(() => {
        window.setTimeout(() => {
            stepEl.setAttribute('tabindex', '-1');
            stepEl.focus();
        }, 0);
        /*
        focus is buggy, a timeout kinda fixes it
        https://stackoverflow.com/questions/1096436/document-getelementbyidid-focus-is-not-working-for-firefox-or-chrome/
        */
    });

const updateSteps = (
    wizardEl: HTMLElement,
    currentPosition: number,
    newPosition: number,
    stepEls: Array<HTMLElement>
): Promise<void> =>
    fastdom.write(() => {
        stepEls.forEach((stepEl: HTMLElement, i: number) => {
            switch (i) {
                case newPosition:
                    stepEl.setAttribute('aria-hidden', 'false');
                    stepEl.removeAttribute('hidden');
                    animateIncomingStep(
                        wizardEl,
                        stepEl,
                        getDirection(currentPosition, newPosition)
                    );
                    break;
                case currentPosition:
                    stepEl.setAttribute('aria-hidden', 'true');
                    stepEl.removeAttribute('hidden');
                    animateOutgoingStep(
                        wizardEl,
                        stepEl,
                        getDirection(currentPosition, newPosition)
                    );
                    break;
                default:
                    stepEl.setAttribute('aria-hidden', 'true');
                    stepEl.setAttribute('hidden', 'hidden');
                    stepEl.classList.add(stepHiddenClassname);
                    stepEl.classList.remove(...stepTransitionClassnames);
            }
        });
    });

const setPosition = (
    wizardEl: HTMLElement,
    unresolvedNewPosition: number | string,
    userInitiated: boolean = true
): Promise<void> =>
    fastdom
        .read(() => [
            /*
            scrolls to the wizard's top (+ a bit of breathing room)
            if it's halfway through a page, and to the page's
            top if it's very close to it, as it looks
            cleaner than scrolling to half of the header
            */
            wizardEl.getBoundingClientRect().top < 120
                ? 0
                : wizardEl.getBoundingClientRect().top - 20,
            parseInt(
                wizardEl.dataset.position ? wizardEl.dataset.position : -1,
                10
            ),
            [...wizardEl.getElementsByClassName(stepClassname)],
        ])
        .then(
            (
                [
                    offsetTop: number,
                    currentPosition: number,
                    stepEls: Array<HTMLElement>,
                ]
            ) => {
                const newPosition: number =
                    typeof unresolvedNewPosition === 'string'
                        ? getPositionFromName(wizardEl, unresolvedNewPosition)
                        : unresolvedNewPosition;
                if (newPosition < 0 || !stepEls[newPosition]) {
                    throw new Error(ERR_WIZARD_INVALID_POSITION);
                }
                if (currentPosition > -1 && window.scrollY > offsetTop) {
                    scrollTo(offsetTop, 250, 'linear');
                }
                wizardEl.dataset.length = stepEls.length.toString();
                wizardEl.dataset.position = newPosition.toString();
                wizardEl.dataset.positionName = getPositionName(
                    wizardEl,
                    newPosition
                );

                return [currentPosition, newPosition, stepEls];
            }
        )
        .then(([currentPosition, newPosition, stepEls]) =>
            Promise.all([
                currentPosition,
                newPosition,
                userInitiated
                    ? pushBrowserState(wizardEl, newPosition) &&
                      updateFocus(stepEls[newPosition])
                    : updateBrowserState(wizardEl, newPosition),
                updateCounter(wizardEl),
                updateSteps(wizardEl, currentPosition, newPosition, stepEls),
            ])
        )
        .then(([currentPosition, newPosition]) =>
            Promise.all([
                getInfoObject(wizardEl, currentPosition),
                getInfoObject(wizardEl, newPosition),
            ])
        )
        .then(([currentInfo, newInfo]) => {
            wizardEl.dispatchEvent(
                new CustomEvent(wizardPageChangedEv, {
                    bubbles: true,
                    detail: {
                        ...newInfo,
                        previous: currentInfo,
                    },
                })
            );
        })
        .catch((error: Error) => {
            if (error.message === ERR_WIZARD_INVALID_POSITION) {
                return setPosition(wizardEl, 0);
            }
            throw error;
        });

const enhance = (wizardEl: HTMLElement): Promise<void> =>
    Promise.all([
        getIdentifier(wizardEl),
        setPosition(wizardEl, 0, false),
    ]).then(([wizardElIdentifier]) => {
        window.addEventListener('popstate', (ev: PopStateEvent) => {
            if (
                ev.state.dispatcher &&
                ev.state.dispatcher === wizardElIdentifier
            ) {
                ev.preventDefault();
                setPosition(wizardEl, parseInt(ev.state.position, 10), false);
            }
        });

        /*
        The following code checks for the
        existence of .closest() to catch any HTMLElement
        derived types such as canvases or svgs
        */
        wizardEl.addEventListener('click', (ev: Event) => {
            if (
                ev.target.closest &&
                ev.target.closest instanceof Function &&
                ev.target.closest(`.${nextButtonElClassname}`) !== null
            ) {
                setPosition(
                    wizardEl,
                    parseInt(wizardEl.dataset.position, 10) + 1
                );
            }
            if (
                ev.target.closest &&
                ev.target.closest instanceof Function &&
                ev.target.closest(`.${prevButtonElClassname}`) !== null
            ) {
                setPosition(
                    wizardEl,
                    parseInt(wizardEl.dataset.position, 10) - 1
                );
            }
        });
    });

export {
    containerClassname,
    wizardPageChangedEv,
    enhance,
    setPosition,
    getInfoObject,
};