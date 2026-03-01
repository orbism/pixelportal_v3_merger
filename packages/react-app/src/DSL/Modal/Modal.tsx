import { Box, Flex, useColorMode, useMultiStyleConfig } from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";
import Draggable from "react-draggable";
import ReactModal from "react-modal";
import Icon from "../Icon/Icon";
import { lightOrDarkMode } from "../Theme";
import Typography, { TVariant } from "../Typography/Typography";
import "./Modal.css";

let globalZIndex = 10;
function nextZIndex() { return ++globalZIndex; }

export interface ModalProps extends ReactModal.Props {
  onClose: () => void;
  size?: "xs" | "sm" | "md" | "lg" | "xl" | "2xl";
  renderFooter?: () => JSX.Element;
  title?: string;
  name?: string;
  defaultPosition?: any;
  description?: string;
}

const baseStyleOverrides: { overlay: object; content: object } = {
  overlay: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    background: "none",
    width: "100vw",
    pointerEvents: "none",
  },
  content: {
    bottom: "unset",
    overflow: "visible",
    padding: 0,
    border: "none",
    borderRadius: 0,
    position: "static",
    background: "none",
    pointerEvents: "none",
    display: "flex",
    justifyContent: "center",
  },
};

const Modal = ({
  isOpen,
  onClose,
  children,
  size = "md",
  title,
  name,
  description,
  defaultPosition,
  ...rest
}: ModalProps) => {
  const chakraStyles = useMultiStyleConfig("Modal", { size: size });
  const { colorMode } = useColorMode();
  const nodeRef = useRef(null);
  const zRef = useRef(nextZIndex());
  const [, setTick] = useState(0);

  useEffect(() => {
    if (isOpen) {
      zRef.current = nextZIndex();
      setTick(t => t + 1);
    }
  }, [isOpen]);

  const bringToFront = () => {
    if (zRef.current < globalZIndex) {
      zRef.current = nextZIndex();
      setTick(t => t + 1);
    }
  };

  const styleOverrides = {
    ...baseStyleOverrides,
    overlay: { ...baseStyleOverrides.overlay, zIndex: zRef.current },
  };

  ReactModal.setAppElement("#root");

  // https://github.com/react-grid-layout/react-draggable/issues/652
  const NotTypeSafeDraggable: any = Draggable;

  return (
    <ReactModal onRequestClose={onClose} isOpen={isOpen} style={styleOverrides} ariaHideApp={false} {...rest}>
      <NotTypeSafeDraggable nodeRef={nodeRef} bounds={"body"} handle={".handle"} defaultPosition={defaultPosition}>
        <Box
          ref={nodeRef}
          position={"relative"}
          overflow={"hidden"}
          resize={"both"}
          zIndex={1}
          width={"100%"}
          minWidth={chakraStyles.container.maxWidth as string}
          maxWidth={"90vw"}
          minHeight={"auto"}
          onMouseDown={bringToFront}
          data-guide-target={name}
        >
          <Box __css={chakraStyles.container}>
            <Flex>
              <Flex
                width={"100%"}
                _hover={{
                  cursor: "pointer",
                }}
                _active={{
                  cursor: "grabbing",
                }}
                className={"handle"}
                justifyContent={"flex-end"}
                borderBottom={"1px solid"}
                borderColor={lightOrDarkMode(colorMode, "black", "white")}
              />
              <Box
                borderLeft={"1px solid"}
                borderBottom={"1px solid"}
                borderColor={lightOrDarkMode(colorMode, "black", "white")}
              >
                <Box
                  p={1}
                  _hover={{ cursor: "pointer" }}
                  color={lightOrDarkMode(colorMode, "black", "white")}
                  onClick={onClose}
                  lineHeight={"normal"}
                >
                  <Icon icon={"close"} boxSize={5} />
                </Box>
              </Box>
            </Flex>
            <Box __css={chakraStyles.body} maxH="70vh" overflowY="auto">
              {title && (
                <Box __css={chakraStyles.title}>
                  <Typography variant={TVariant.PresStart18}>{title}</Typography>
                </Box>
              )}
              {description && (
                <Box __css={chakraStyles.description}>
                  <Typography variant={TVariant.ComicSans16}>{description}</Typography>
                </Box>
              )}
              {children}
            </Box>
          </Box>
        </Box>
      </NotTypeSafeDraggable>
    </ReactModal>
  );
};

export default Modal;
