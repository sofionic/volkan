FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

COPY stargate/StargateService/StargateService.csproj stargate/StargateService/
RUN dotnet restore stargate/StargateService/StargateService.csproj

COPY . .
WORKDIR /src/stargate/StargateService
RUN dotnet publish -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app

COPY --from=build /app/publish .

ENV ASPNETCORE_URLS=http://0.0.0.0:5000
ENV PythonAutomation__Enabled=false

ENTRYPOINT ["dotnet", "StargateService.dll"]
