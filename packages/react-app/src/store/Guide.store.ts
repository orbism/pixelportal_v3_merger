import { makeObservable, observable, action, computed } from "mobx";
import LocalStorage from "../services/local-storage";
import { GUIDE_STEPS } from "../components/SiteGuide/guideSteps";

const HAS_SEEN_GUIDE_KEY = "has_seen_site_guide";

class GuideStore {
  @observable
  isGuideActive = false;

  @observable
  currentStep = 0;

  @observable
  hasSeenGuide = false;

  @observable
  showFinalMessage = false;

  constructor() {
    makeObservable(this);
  }

  @action
  init() {
    this.hasSeenGuide = LocalStorage.getItem(HAS_SEEN_GUIDE_KEY, LocalStorage.PARSE_JSON, false);
  }

  @action
  startGuide() {
    this.isGuideActive = true;
    this.currentStep = 0;
    this.showFinalMessage = false;
  }

  @action
  nextStep() {
    if (this.currentStep < GUIDE_STEPS.length - 1) {
      this.currentStep++;
    } else {
      this.endGuide();
    }
  }

  @action
  endGuide() {
    // Show final "LFD" message
    this.showFinalMessage = true;
    
    setTimeout(() => {
      this.showFinalMessage = false;
      this.isGuideActive = false;
      this.currentStep = 0;
      this.hasSeenGuide = true;
      LocalStorage.setItem(HAS_SEEN_GUIDE_KEY, true);
    }, 2000);
  }

  @action
  skipGuide() {
    this.isGuideActive = false;
    this.currentStep = 0;
    this.hasSeenGuide = true;
    LocalStorage.setItem(HAS_SEEN_GUIDE_KEY, true);
  }

  @computed
  get currentGuideStep() {
    return GUIDE_STEPS[this.currentStep];
  }

  @computed
  get isFirstStep() {
    return this.currentStep === 0;
  }

  @computed
  get isLastStep() {
    return this.currentStep === GUIDE_STEPS.length - 1;
  }
}

export default GuideStore;

