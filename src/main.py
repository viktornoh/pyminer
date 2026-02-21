from pyminer.config import load_config
from pyminer.game import Game


def main():
    cfg = load_config()
    Game(cfg).run()


if __name__ == "__main__":
    main()
