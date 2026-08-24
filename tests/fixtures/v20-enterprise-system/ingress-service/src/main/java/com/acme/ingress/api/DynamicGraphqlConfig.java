package com.acme.ingress.api;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.graphql.execution.RuntimeWiringConfigurer;

@Configuration
public class DynamicGraphqlConfig {
    @Bean RuntimeWiringConfigurer runtimeWiringConfigurer() {
        return builder -> builder.type("Query", type -> type.dataFetcher("dynamicOrder", environment -> "dynamic"));
    }
}
