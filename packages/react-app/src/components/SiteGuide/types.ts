export interface GuideStep {
  id: string;
  targetElement: string; // CSS selector or data-guide-target value
  modalPosition: 'top-left' | 'top-right' | 'center' | 'bottom';
  content: string;
  modalOffset?: { x: number; y: number };
  showLogo: boolean; // always true to keep logo clickable
  allowSkip: boolean;
}

export interface GuideStepTarget {
  element: HTMLElement;
  rect: DOMRect;
}

