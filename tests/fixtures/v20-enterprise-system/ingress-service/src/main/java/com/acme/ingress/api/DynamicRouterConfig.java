package com.acme.ingress.api;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.reactive.function.server.RouterFunction;
import org.springframework.web.reactive.function.server.ServerResponse;
import static org.springframework.web.reactive.function.server.RequestPredicates.GET;
import static org.springframework.web.reactive.function.server.RouterFunctions.route;

@Configuration
public class DynamicRouterConfig {
    @Value("${runtime.order-path}") private String runtimePath;
    @Bean RouterFunction<ServerResponse> dynamicOrderRoute() {
        return route(GET(runtimePath), request -> ServerResponse.ok().bodyValue(request.path()));
    }
}
