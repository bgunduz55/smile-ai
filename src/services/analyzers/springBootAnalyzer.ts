import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { LanguageAnalyzer, AnalysisResult, SemanticNode, CodeMetrics } from '../types/analysis';

interface SpringSymbol {
    name: string;
    type: 'controller' | 'service' | 'repository' | 'component' | 'entity' | 'configuration';
    path?: string;
    methods?: string[];
    dependencies?: string[];
    annotations?: string[];
    metadata?: any;
    documentation?: string;
    location: {
        line: number;
        column: number;
        endLine: number;
        endColumn: number;
    };
}

export class SpringBootAnalyzer implements LanguageAnalyzer {
    private analysisCache: Map<string, AnalysisResult> = new Map();

    public async analyzeFile(document: vscode.TextDocument): Promise<AnalysisResult> {
        const filePath = document.uri.fsPath;
        
        // Önbellekten sonucu döndür
        const cached = this.analysisCache.get(filePath);
        if (cached) {
            return cached;
        }

        const content = document.getText();
        const result = await this.analyzeSpringContent(content);
        this.analysisCache.set(filePath, result);
        return result;
    }

    private async analyzeSpringContent(content: string): Promise<AnalysisResult> {
        try {
            // Java analiz script'ini oluştur
            const javaScript = `
import com.github.javaparser.JavaParser;
import com.github.javaparser.ast.*;
import com.github.javaparser.ast.body.*;
import com.github.javaparser.ast.expr.*;
import com.github.javaparser.ast.visitor.VoidVisitorAdapter;
import org.json.JSONObject;
import org.json.JSONArray;
import java.util.*;

public class SpringAnalyzer {
    private static class AnalysisVisitor extends VoidVisitorAdapter<Void> {
        private int complexity = 0;
        private final Map<String, JSONObject> symbols = new HashMap<>();
        private final Map<String, List<String>> dependencies = new HashMap<>();
        
        @Override
        public void visit(ClassOrInterfaceDeclaration n, Void arg) {
            JSONObject symbol = new JSONObject();
            String type = getClassType(n);
            
            symbol.put("type", type);
            symbol.put("name", n.getNameAsString());
            symbol.put("line", n.getBegin().get().line);
            symbol.put("column", n.getBegin().get().column);
            symbol.put("endLine", n.getEnd().get().line);
            symbol.put("endColumn", n.getEnd().get().column);
            symbol.put("documentation", n.getJavadoc().map(j -> j.toString()).orElse(""));
            symbol.put("annotations", getAnnotations(n));
            
            if (type.equals("controller")) {
                symbol.put("path", getRequestMapping(n));
                symbol.put("methods", getRequestMethods(n));
            }
            
            if (type.equals("service") || type.equals("component")) {
                symbol.put("dependencies", getDependencies(n));
            }
            
            if (type.equals("repository")) {
                symbol.put("entity", getRepositoryEntity(n));
            }
            
            symbols.put(n.getNameAsString(), symbol);
            super.visit(n, arg);
        }
        
        private String getClassType(ClassOrInterfaceDeclaration n) {
            if (hasAnnotation(n, "RestController") || hasAnnotation(n, "Controller"))
                return "controller";
            if (hasAnnotation(n, "Service"))
                return "service";
            if (hasAnnotation(n, "Repository"))
                return "repository";
            if (hasAnnotation(n, "Component"))
                return "component";
            if (hasAnnotation(n, "Entity"))
                return "entity";
            if (hasAnnotation(n, "Configuration"))
                return "configuration";
            return "class";
        }
        
        private boolean hasAnnotation(NodeWithAnnotations<?> n, String name) {
            return n.getAnnotations().stream()
                .anyMatch(a -> a.getNameAsString().equals(name) ||
                             a.getNameAsString().equals(name + "Rest"));
        }
        
        private JSONArray getAnnotations(NodeWithAnnotations<?> n) {
            JSONArray annotations = new JSONArray();
            n.getAnnotations().forEach(a -> 
                annotations.put(a.getNameAsString())
            );
            return annotations;
        }
        
        private String getRequestMapping(ClassOrInterfaceDeclaration n) {
            return n.getAnnotations().stream()
                .filter(a -> a.getNameAsString().equals("RequestMapping"))
                .findFirst()
                .map(a -> a.asSingleMemberAnnotationExpr().getMemberValue().toString())
                .orElse("");
        }
        
        private JSONArray getRequestMethods(ClassOrInterfaceDeclaration n) {
            JSONArray methods = new JSONArray();
            n.getMethods().forEach(m -> {
                if (m.getAnnotations().stream().anyMatch(a -> 
                    a.getNameAsString().matches("(Get|Post|Put|Delete|Patch)Mapping"))) {
                    methods.put(m.getNameAsString());
                }
            });
            return methods;
        }
        
        private JSONArray getDependencies(ClassOrInterfaceDeclaration n) {
            JSONArray deps = new JSONArray();
            n.getFields().stream()
                .filter(f -> f.getAnnotations().stream()
                    .anyMatch(a -> a.getNameAsString().equals("Autowired")))
                .forEach(f -> deps.put(f.getElementType().toString()));
            return deps;
        }
        
        private String getRepositoryEntity(ClassOrInterfaceDeclaration n) {
            return n.getImplementedTypes().stream()
                .filter(t -> t.getNameAsString().startsWith("JpaRepository"))
                .findFirst()
                .map(t -> t.getTypeArguments().get().get(0).toString())
                .orElse("");
        }
        
        @Override
        public void visit(MethodDeclaration n, Void arg) {
            complexity++;
            super.visit(n, arg);
        }
        
        @Override
        public void visit(IfStmt n, Void arg) {
            complexity++;
            super.visit(n, arg);
        }
        
        @Override
        public void visit(WhileStmt n, Void arg) {
            complexity++;
            super.visit(n, arg);
        }
        
        @Override
        public void visit(ForStmt n, Void arg) {
            complexity++;
            super.visit(n, arg);
        }
        
        @Override
        public void visit(SwitchStmt n, Void arg) {
            complexity++;
            super.visit(n, arg);
        }
        
        @Override
        public void visit(TryStmt n, Void arg) {
            complexity++;
            super.visit(n, arg);
        }
        
        public JSONObject getResult() {
            JSONObject result = new JSONObject();
            result.put("complexity", complexity);
            result.put("symbols", new JSONObject(symbols));
            result.put("dependencies", new JSONObject(dependencies));
            return result;
        }
    }
    
    public static void main(String[] args) {
        try {
            // Stdin'den kodu oku
            Scanner scanner = new Scanner(System.in);
            StringBuilder code = new StringBuilder();
            while (scanner.hasNextLine()) {
                code.append(scanner.nextLine()).append("\\n");
            }
            
            // Kodu parse et
            JavaParser parser = new JavaParser();
            CompilationUnit cu = parser.parse(code.toString()).getResult().get();
            
            // AST analizi yap
            AnalysisVisitor visitor = new AnalysisVisitor();
            visitor.visit(cu, null);
            
            // Yorum satırlarını say
            long commentLines = Arrays.stream(code.toString().split("\\n"))
                .filter(line -> line.trim().startsWith("//") || line.trim().startsWith("/*"))
                .count();
            
            // Toplam satır sayısı
            long totalLines = code.toString().split("\\n").length;
            
            // Sonucu oluştur
            JSONObject result = visitor.getResult();
            result.put("lines_of_code", totalLines);
            result.put("comment_lines", commentLines);
            
            System.out.println(result.toString());
            
        } catch (Exception e) {
            JSONObject error = new JSONObject();
            error.put("error", e.getMessage());
            System.out.println(error.toString());
        }
    }
}`;

            // Java process'ini başlat
            const javaProcess = spawn('java', ['-cp', 'javaparser-core.jar:json.jar', 'SpringAnalyzer']);
            
            // Kodu gönder
            javaProcess.stdin.write(content);
            javaProcess.stdin.end();

            // Sonucu al
            const output = await new Promise<string>((resolve, reject) => {
                let result = '';
                javaProcess.stdout.on('data', (data) => {
                    result += data.toString();
                });
                javaProcess.stderr.on('data', (data) => {
                    console.error('Spring analiz hatası:', data.toString());
                });
                javaProcess.on('close', (code) => {
                    if (code === 0) {
                        resolve(result);
                    } else {
                        reject(new Error('Spring analizi başarısız oldu'));
                    }
                });
            });

            const analysisResult = JSON.parse(output);
            
            if (analysisResult.error) {
                throw new Error(analysisResult.error);
            }

            // Sonuçları VSCode formatına dönüştür
            return {
                ast: this.createASTNode(analysisResult),
                symbols: this.createSymbolsMap(analysisResult.symbols),
                dependencies: this.createDependenciesMap(analysisResult.dependencies),
                metrics: this.createMetrics(analysisResult)
            };

        } catch (error) {
            console.error('Spring analiz hatası:', error);
            throw error;
        }
    }

    private createASTNode(result: any): SemanticNode {
        return {
            type: 'CompilationUnit',
            name: 'root',
            location: new vscode.Location(
                vscode.Uri.file(''),
                new vscode.Range(0, 0, 0, 0)
            ),
            children: []
        };
    }

    private createSymbolsMap(symbols: any): Map<string, SemanticNode> {
        const result = new Map<string, SemanticNode>();
        
        for (const [name, info] of Object.entries<any>(symbols)) {
            result.set(name, {
                type: info.type,
                name: name,
                location: new vscode.Location(
                    vscode.Uri.file(''),
                    new vscode.Range(
                        info.line - 1,
                        info.column - 1,
                        info.endLine - 1,
                        info.endColumn - 1
                    )
                ),
                documentation: info.documentation
            });
        }
        
        return result;
    }

    private createDependenciesMap(dependencies: any): Map<string, string[]> {
        return new Map(Object.entries(dependencies));
    }

    private createMetrics(result: any): CodeMetrics {
        return {
            complexity: result.complexity,
            linesOfCode: result.lines_of_code,
            commentLines: result.comment_lines,
            dependencies: Object.keys(result.dependencies || {}).length,
            maintainabilityIndex: this.calculateMaintainabilityIndex(
                result.complexity,
                result.lines_of_code,
                result.comment_lines
            )
        };
    }

    private calculateMaintainabilityIndex(
        complexity: number,
        linesOfCode: number,
        commentLines: number
    ): number {
        const avgComplexity = complexity / (linesOfCode || 1);
        const commentRatio = commentLines / (linesOfCode || 1);
        
        return Math.max(0, Math.min(100,
            171 -
            5.2 * Math.log(avgComplexity || 1) -
            0.23 * Math.log(linesOfCode || 1) -
            16.2 * Math.log(commentRatio || 0.01)
        ));
    }

    public dispose(): void {
        this.analysisCache.clear();
    }
} 