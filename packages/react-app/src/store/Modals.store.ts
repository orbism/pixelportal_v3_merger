import { makeObservable, observable } from "mobx";
import { showTOSToast } from "../DSL/Toast/Toast";
import LocalStorage from "../services/local-storage";

export enum ModalName {
  Mint = "mint",
  Burn = "burn",
  Helper = "helper",
  MintMeme = "mintmeme",
  BurnMeme = "burnmeme",
}

const SHOW_HELPER_MODAL = "show_helper_modal";
const SHOW_INFO_MODAL = "show_info_modal";
const SHOW_TOS_TOAST = "show_tos_toast";

export enum ModalType {
  Mint,
  Burn,
  Scroll,
  MintMeme,
  BurnMeme,
  Info,
  MyPixels,
  SelectedPixel,
}

class ModalsStore {
  @observable
  isMintModalOpen = false;

  @observable
  isBurnModalOpen = false;

  @observable
  isScrollModalOpen = false;

  @observable
  isMintMemeModalOpen = false;

  @observable
  isBurnMemeModalOpen = false;

  @observable
  isInfoModalOpen = true;

  @observable
  isMyPixelsModalOpen = false;

  @observable
  isSelectedPixelModalOpen = false;

  @observable
  isTermsToastOpen = false;

  constructor() {
    makeObservable(this);
  }

  init() {
    this.isTermsToastOpen = LocalStorage.getItem(SHOW_TOS_TOAST, LocalStorage.PARSE_JSON, true);
    if (this.isTermsToastOpen) {
      showTOSToast(() => LocalStorage.setItem(SHOW_TOS_TOAST, false));
    }
    this.isScrollModalOpen = LocalStorage.getItem(SHOW_HELPER_MODAL, LocalStorage.PARSE_JSON, true);
    LocalStorage.setItem(SHOW_HELPER_MODAL, false);

    // this.isInfoModalOpen = LocalStorage.getItem(SHOW_INFO_MODAL, LocalStorage.PARSE_JSON, true);
  }

  toggleInfoModal() {
    this.isInfoModalOpen = !this.isInfoModalOpen;
    LocalStorage.setItem(SHOW_INFO_MODAL, this.isInfoModalOpen);
  }

  closeModals() {
    this.isMintModalOpen = false;
    this.isBurnModalOpen = false;
    this.isScrollModalOpen = false;
    this.isMintMemeModalOpen = false;
    this.isBurnMemeModalOpen = false;
    this.isMyPixelsModalOpen = false;
    this.isSelectedPixelModalOpen = false;
  }

  openModal(modal: ModalType) {
    this.closeModals();

    switch (modal) {
      case ModalType.Mint:
        this.isMintModalOpen = true;
        break;
      case ModalType.Burn:
        this.isBurnModalOpen = true;
        break;
      case ModalType.Scroll:
        this.isScrollModalOpen = true;
        break;
      case ModalType.MintMeme:
        this.isMintMemeModalOpen = true;
        break;
      case ModalType.BurnMeme:
        this.isBurnMemeModalOpen = true;
        break;
      case ModalType.MyPixels:
        this.isMyPixelsModalOpen = true;
        break;
      case ModalType.SelectedPixel:
        this.isSelectedPixelModalOpen = true;
        break;
    }
  }
}

export default ModalsStore;
