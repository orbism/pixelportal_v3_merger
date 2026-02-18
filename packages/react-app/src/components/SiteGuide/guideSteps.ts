import { GuideStep } from "./types";

export const GUIDE_STEPS: GuideStep[] = [
  {
    id: 'welcome',
    targetElement: 'body',
    modalPosition: 'center',
    content: 'Welcome to the Pixel Portal. You can exit this first-time user guide at any time by clicking on the logo at the top left of the site.',
    showLogo: true,
    allowSkip: true,
  },
  {
    id: 'info-modal',
    targetElement: '[data-guide-target="info-modal"]',
    modalPosition: 'top-right',
    content: 'Here you can learn the basics about the Pixel Portal',
    showLogo: true,
    allowSkip: true,
  },
  {
    id: 'wallet-connect',
    targetElement: '[data-guide-target="wallet-button"]',
    modalPosition: 'top-right',
    content: 'Connect your wallet and view your DOG & Pixels you hold here',
    showLogo: true,
    allowSkip: true,
  },
  {
    id: 'mint-button',
    targetElement: '[data-guide-target="mint-button"]',
    modalPosition: 'top-right',
    content: 'Start by minting Pixels here by locking 55,240 $DOG per Pixel!',
    showLogo: true,
    allowSkip: true,
  },
  {
    id: 'claim-button',
    targetElement: '[data-guide-target="claim-button"]',
    modalPosition: 'top-right',
    content: 'If you held v1 or v2 Pixels and burned them, you can claim your Pixels on v3 here.',
    showLogo: true,
    allowSkip: true,
  },
  {
    id: 'burn-button',
    targetElement: '[data-guide-target="burn-button"]',
    modalPosition: 'top-right',
    content: 'Once you mint Pixels, you can choose to unlock your DOG by burning them here.',
    showLogo: true,
    allowSkip: true,
  },
  {
    id: 'menu',
    targetElement: '[data-guide-target="menu-button"]',
    modalPosition: 'top-left',
    content: 'You can check out the leaderbork and other cool utilities here!',
    showLogo: true,
    allowSkip: true,
  },
];

