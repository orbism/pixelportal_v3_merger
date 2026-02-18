import { Box, Flex, HStack, useColorMode, Grid } from "@chakra-ui/react";
import { observer } from "mobx-react-lite";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXTwitter, faDiscord, faTiktok, faInstagram, faYoutube, faTelegram } from '@fortawesome/free-brands-svg-icons';
import { faChevronUp, faChevronDown } from '@fortawesome/free-solid-svg-icons';
import { lightOrDarkMode } from "../../DSL/Theme";
import Typography, { TVariant } from "../../DSL/Typography/Typography";
import { Type } from "../../DSL/Fonts/Fonts";
import Link from "../../DSL/Link/Link";
import Button from "../../DSL/Button/Button";
import AppStore from "../../store/App.store";
import { readLinks, socialLinks, dooLinks, tradeLinks } from "./Links";
import dogeface from '../../images/dogeface.png';

const MotionBox = motion(Box);

const FooterDrawer = observer(() => {
  const [isOpen, setIsOpen] = useState(false);
  const { colorMode } = useColorMode();
  const currentYear = new Date().getFullYear();

  const toggleDrawer = () => setIsOpen(!isOpen);

  return (
    <>
      {/* Overlay */}
      <AnimatePresence>
        {isOpen && (
          <MotionBox
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            position="fixed"
            top={0}
            left={0}
            right={0}
            bottom={0}
            bg="blackAlpha.600"
            zIndex={998}
            onClick={toggleDrawer}
          />
        )}
      </AnimatePresence>

      {/* Drawer Content */}
      <AnimatePresence>
        {isOpen && (
          <MotionBox
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{
              type: "spring",
              damping: 25,
              stiffness: 300,
              mass: 0.8,
            }}
            position="fixed"
            bottom="35px"
            left={0}
            right={0}
            zIndex={999}
            bg={lightOrDarkMode(colorMode, "#F1F2F3", "purple.700")}
            borderTop="2px solid"
            borderColor={lightOrDarkMode(colorMode, "black", "white")}
            maxHeight="80vh"
            overflowY="auto"
          >
            <Box maxW="8xl" mx="auto" p={8}>
              <Box flexGrow={1} py={8}>
                <Grid templateColumns={{ base: "repeat(2, 1fr)", md: "repeat(5, 1fr)" }} columnGap={10} rowGap={8}>
                  <Box display="flex" justifyContent="flex-start" alignItems="flex-start">
                    <img src={dogeface} alt="Dogeface" style={{ width: '100%', maxWidth: '100px' }} />
                  </Box>
                  <FooterItem title={"Talk"} items={socialLinks} />
                  <FooterItem title={"Read"} items={readLinks} />
                  <FooterItem title={"Do"} items={dooLinks} />
                  <FooterItem title={"$DOG"} items={tradeLinks} />
                </Grid>
              </Box>
              <Box pt={4} pb={2}>
                <Button size="xs" onClick={() => { AppStore.guide.startGuide(); setIsOpen(false); }}>
                  Run Interactive User Guide
                </Button>
              </Box>
            </Box>
          </MotionBox>
        )}
      </AnimatePresence>

      {/* Fixed Bottom Strip */}
      <Box
        position="fixed"
        bottom={0}
        left={0}
        right={0}
        height="35px"
        bg={lightOrDarkMode(colorMode, "#F1F2F3", "purple.800")}
        borderTop="2px solid"
        borderColor={lightOrDarkMode(colorMode, "black", "white")}
        zIndex={1000}
      >
        <Flex h="full" alignItems="center" justifyContent="space-between" px={4} maxW="8xl" mx="auto">
          {/* Left: Copyright */}
          <Typography variant={TVariant.ComicSans14} opacity={0.7}>
            © {currentYear}, Own The Doge
          </Typography>

          {/* Right: Social Icons */}
          <HStack spacing={{ base: 2, md: 3 }} alignItems="center">
            <SocialIcon href="https://x.com/ownthedoge" icon={faXTwitter} />
            <SocialIcon href="https://discord.gg/invite/ownthedoge" icon={faDiscord} />
            <SocialIcon href="https://tiktok.com/@ownthedoge" icon={faTiktok} />
            <SocialIcon href="https://instagram.com/ownthedoge" icon={faInstagram} />
            <SocialIcon href="https://www.youtube.com/@ownthedoge" icon={faYoutube} />
            <SocialIcon href="https://t.me/ownthedoge" icon={faTelegram} />
          </HStack>
        </Flex>

        {/* Protruding Tab */}
        <Box
          position="absolute"
          bottom="35px"
          right="20px"
          width="60px"
          height="30px"
          bg={lightOrDarkMode(colorMode, "#F1F2F3", "purple.800")}
          borderTop="2px solid"
          borderLeft="2px solid"
          borderRight="2px solid"
          borderColor={lightOrDarkMode(colorMode, "black", "white")}
          borderTopLeftRadius="8px"
          borderTopRightRadius="8px"
          cursor="pointer"
          onClick={toggleDrawer}
          display="flex"
          alignItems="center"
          justifyContent="center"
          transition="all 0.2s"
          _hover={{
            bg: lightOrDarkMode(colorMode, "#E0E1E2", "purple.700"),
            transform: "translateY(-2px)",
          }}
          _active={{
            transform: "translateY(0px)",
          }}
        >
          <FontAwesomeIcon 
            icon={isOpen ? faChevronDown : faChevronUp} 
            color={lightOrDarkMode(colorMode, "#302D25", "white")}
            size="sm"
          />
        </Box>
      </Box>
    </>
  );
});

const SocialIcon: React.FC<{ href: string; icon: any }> = ({ href, icon }) => {
  const { colorMode } = useColorMode();
  return (
    <a
      target="_blank"
      rel="noreferrer"
      href={href}
      style={{
        display: "flex",
        alignItems: "center",
        color: lightOrDarkMode(colorMode, "#302D25", "white"),
        transition: "color 0.2s",
      }}
      onMouseEnter={e => (e.currentTarget.style.color = "#EB3E3E")}
      onMouseLeave={e => (e.currentTarget.style.color = lightOrDarkMode(colorMode, "#302D25", "white"))}
    >
      <FontAwesomeIcon icon={icon} size="lg" style={{ fontSize: window.innerWidth < 768 ? "16px" : "18px" }} />
    </a>
  );
};

const FooterItem: React.FC<{ title: string; items: { title: string; link: string }[] }> = ({ title, items }) => {
  const { colorMode } = useColorMode();
  return (
    <Box>
      <Typography
        block
        mb={3}
        opacity={0.5}
        color={lightOrDarkMode(colorMode, "black", "white")}
        fontWeight={"bold"}
        variant={TVariant.ComicSans14}
      >
        {title}
      </Typography>
      <Grid templateRows={"1fr 1fr 1fr"}>
        {items.map(item => (
          <Link
            key={`${item.title}`}
            opacity={0.5}
            size="sm"
            target={"_blank"}
            variant={Type.ComicSans}
            href={item.link}
          >
            {item.title}
          </Link>
        ))}
      </Grid>
    </Box>
  );
};

export default FooterDrawer;

