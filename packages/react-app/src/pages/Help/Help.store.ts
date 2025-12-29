import { makeAutoObservable } from "mobx";

export enum SubmissionStatus {
  IDLE = "idle",
  SUBMITTING = "submitting",
  SUCCESS = "success",
  ERROR = "error",
}

const SESSION_STORAGE_KEY = "helpTicketSubmissions";
const MAX_SUBMISSIONS = 3;

class HelpStore {
  submissionStatus: SubmissionStatus = SubmissionStatus.IDLE;
  errorMessage: string = "";
  ticketId: number | null = null;
  submissionCount: number = 0;
  canSubmitAnother: boolean = true;

  constructor() {
    makeAutoObservable(this);
    this.loadSubmissionCount();
  }

  loadSubmissionCount() {
    try {
      const stored = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (stored) {
        this.submissionCount = parseInt(stored, 10);
      }
    } catch (e) {
      // sessionStorage might not be available
      console.warn("Failed to load submission count from sessionStorage", e);
    }
  }

  incrementSubmissionCount() {
    this.submissionCount += 1;
    try {
      sessionStorage.setItem(SESSION_STORAGE_KEY, this.submissionCount.toString());
    } catch (e) {
      console.warn("Failed to save submission count to sessionStorage", e);
    }
  }

  get hasSubmittedBefore(): boolean {
    return this.submissionCount > 0;
  }

  get hasReachedLimit(): boolean {
    return this.submissionCount >= MAX_SUBMISSIONS;
  }

  get canSubmit(): boolean {
    return !this.hasReachedLimit && this.canSubmitAnother;
  }

  setCanSubmitAnother(value: boolean) {
    this.canSubmitAnother = value;
  }

  setSubmissionStatus(status: SubmissionStatus) {
    this.submissionStatus = status;
  }

  setErrorMessage(message: string) {
    this.errorMessage = message;
  }

  setTicketId(id: number) {
    this.ticketId = id;
  }

  reset() {
    this.submissionStatus = SubmissionStatus.IDLE;
    this.errorMessage = "";
    this.ticketId = null;
  }
}

export default HelpStore;

