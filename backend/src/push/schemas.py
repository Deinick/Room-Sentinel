from pydantic import BaseModel, Field

# What Notifications.getExpoPushTokenAsync() returns, e.g. ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx].
EXPO_TOKEN_PATTERN = r"^(ExponentPushToken|ExpoPushToken)\[[^\[\]]+\]$"


class PushTokenIn(BaseModel):
    token: str = Field(pattern=EXPO_TOKEN_PATTERN, max_length=255)
